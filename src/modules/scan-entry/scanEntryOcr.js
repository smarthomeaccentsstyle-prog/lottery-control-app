function waitForImageLoad(image) {
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Ticket image could not be opened"));
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function scaleDimensions(width, height, targetLongEdge = 1600) {
  const longestSide = Math.max(width, height);

  if (!longestSide) {
    return {
      width,
      height,
    };
  }

  const scaleFactor =
    longestSide < 1100 ? 1100 / longestSide : Math.min(1, targetLongEdge / longestSide);

  return {
    width: Math.max(1, Math.round(width * scaleFactor)),
    height: Math.max(1, Math.round(height * scaleFactor)),
  };
}

function applyBinaryEnhancement(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return canvas;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const grayscale = red * 0.299 + green * 0.587 + blue * 0.114;
    const contrasted = grayscale > 150 ? 255 : 0;

    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
    data[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function flattenOcrLines(blocks = []) {
  return blocks.flatMap((block) =>
    Array.isArray(block && block.paragraphs)
      ? block.paragraphs.flatMap((paragraph) =>
          Array.isArray(paragraph && paragraph.lines)
            ? paragraph.lines.map((line) => ({
                text: line && line.text ? line.text : "",
                confidence: line && typeof line.confidence === "number" ? line.confidence : 0,
              }))
            : []
        )
      : []
  );
}

async function getTesseractCreateWorker() {
  const module = await import("tesseract.js");
  const createWorker =
    module && module.createWorker
      ? module.createWorker
      : module && module.default && module.default.createWorker
        ? module.default.createWorker
        : null;

  if (!createWorker) {
    throw new Error("OCR engine could not be loaded");
  }

  return createWorker;
}

export function stopMediaStream(stream) {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
}

export async function startRearCamera(videoElement) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Camera is not supported on this device");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: {
        ideal: "environment",
      },
      width: {
        ideal: 1280,
      },
      height: {
        ideal: 1920,
      },
    },
  });

  videoElement.srcObject = stream;

  await new Promise((resolve) => {
    videoElement.onloadedmetadata = () => resolve();
  });

  await videoElement.play();
  return stream;
}

export function captureVideoFrame(videoElement) {
  const width = videoElement.videoWidth || 0;
  const height = videoElement.videoHeight || 0;

  if (!width || !height) {
    throw new Error("Camera frame is not ready yet");
  }

  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Camera capture is not available");
  }

  context.drawImage(videoElement, 0, 0, width, height);
  return canvas;
}

export async function loadFileToCanvas(file) {
  if (!file) {
    throw new Error("Ticket image is missing");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await waitForImageLoad(image);

    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Image canvas is not available");
    }

    context.drawImage(image, 0, 0, image.width, image.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function createPreviewDataUrl(sourceCanvas) {
  return sourceCanvas.toDataURL("image/jpeg", 0.92);
}

export function enhanceCanvasForOcr(sourceCanvas) {
  const dimensions = scaleDimensions(sourceCanvas.width, sourceCanvas.height);
  const canvas = createCanvas(dimensions.width, dimensions.height);
  const context = canvas.getContext("2d");

  if (!context) {
    return sourceCanvas;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);

  return applyBinaryEnhancement(canvas);
}

export async function recognizeTicketImage(sourceCanvas, options = {}) {
  const { onProgress } = options;
  const createWorker = await getTesseractCreateWorker();
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (onProgress) {
        onProgress(message);
      }
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- /:\n",
    });

    const result = await worker.recognize(
      sourceCanvas,
      {
        rotateAuto: true,
      },
      {
        text: true,
        blocks: true,
      }
    );
    const lines = flattenOcrLines(result && result.data && result.data.blocks ? result.data.blocks : []);

    return {
      confidence:
        result && result.data && typeof result.data.confidence === "number"
          ? result.data.confidence
          : 0,
      text: result && result.data && result.data.text ? result.data.text : "",
      lines:
        lines.length > 0
          ? lines
          : String(result && result.data && result.data.text ? result.data.text : "")
              .split("\n")
              .map((line) => ({
                text: line,
                confidence:
                  result && result.data && typeof result.data.confidence === "number"
                    ? result.data.confidence
                    : 0,
              })),
    };
  } catch (error) {
    throw new Error(error && error.message ? error.message : "OCR scan failed");
  } finally {
    await worker.terminate();
  }
}

