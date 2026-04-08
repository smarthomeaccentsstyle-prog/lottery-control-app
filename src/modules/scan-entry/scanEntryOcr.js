const SECTION_SCAN_ORDER = ["third", "fourth", "juri"];

const SECTION_OCR_CONFIG = {
  third: {
    label: "3rd house",
    whitelist: "0123456789=- \n",
    pageSegMode: "6",
  },
  fourth: {
    label: "4th house",
    whitelist: "0123456789=- \n",
    pageSegMode: "6",
  },
  juri: {
    label: "juri grid",
    whitelist: "0123456789=- \n",
    pageSegMode: "11",
  },
};

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

function scaleDimensions(width, height, targetLongEdge = 1800) {
  const longestSide = Math.max(width, height);

  if (!longestSide) {
    return {
      width,
      height,
    };
  }

  const scaleFactor =
    longestSide < 1200 ? 1200 / longestSide : Math.min(1, targetLongEdge / longestSide);

  return {
    width: Math.max(1, Math.round(width * scaleFactor)),
    height: Math.max(1, Math.round(height * scaleFactor)),
  };
}

function computeThreshold(data) {
  let total = 0;
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    total += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    count += 1;
  }

  if (!count) {
    return 155;
  }

  return Math.max(115, Math.min(185, Math.round(total / count) - 18));
}

function applyBinaryEnhancement(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return canvas;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const threshold = computeThreshold(data);

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const grayscale = red * 0.299 + green * 0.587 + blue * 0.114;
    const contrasted = grayscale > threshold ? 255 : 0;

    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
    data[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function getImageData(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return null;
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function isInkPixel(data, index) {
  return data[index] < 128;
}

function findInkBounds(imageData, width, height) {
  const { data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;

      if (!isInkPixel(data, index)) {
        continue;
      }

      if (x < minX) {
        minX = x;
      }

      if (y < minY) {
        minY = y;
      }

      if (x > maxX) {
        maxX = x;
      }

      if (y > maxY) {
        maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return {
      left: 0,
      top: 0,
      width,
      height,
    };
  }

  return {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
  };
}

function expandRect(rect, padding, maxWidth, maxHeight) {
  const left = Math.max(0, rect.left - padding);
  const top = Math.max(0, rect.top - padding);
  const right = Math.min(maxWidth, rect.left + rect.width + padding);
  const bottom = Math.min(maxHeight, rect.top + rect.height + padding);

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function buildAxisDensities(imageData, bounds) {
  const { data, width } = imageData;
  const rowRatios = Array(bounds.height).fill(0);
  const colRatios = Array(bounds.width).fill(0);

  for (let y = bounds.top; y < bounds.top + bounds.height; y += 1) {
    let rowInkCount = 0;

    for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
      const index = (y * width + x) * 4;

      if (!isInkPixel(data, index)) {
        continue;
      }

      rowInkCount += 1;
      colRatios[x - bounds.left] += 1;
    }

    rowRatios[y - bounds.top] = rowInkCount / bounds.width;
  }

  for (let index = 0; index < colRatios.length; index += 1) {
    colRatios[index] = colRatios[index] / bounds.height;
  }

  return {
    rowRatios,
    colRatios,
  };
}

function sumValues(values, start, end) {
  let total = 0;

  for (let index = start; index < end; index += 1) {
    total += values[index] || 0;
  }

  return total;
}

function findLowestDensityIndex(values, start, end, fallback) {
  let bestIndex = fallback;
  let lowestValue = Number.POSITIVE_INFINITY;

  for (let index = start; index < end; index += 1) {
    const nextValue = values[index];

    if (typeof nextValue !== "number") {
      continue;
    }

    if (nextValue < lowestValue) {
      lowestValue = nextValue;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function fitRectToInk(imageData, rect, padding = 12) {
  const { data, width, height } = imageData;
  let minX = rect.left + rect.width;
  let minY = rect.top + rect.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const index = (y * width + x) * 4;

      if (!isInkPixel(data, index)) {
        continue;
      }

      if (x < minX) {
        minX = x;
      }

      if (y < minY) {
        minY = y;
      }

      if (x > maxX) {
        maxX = x;
      }

      if (y > maxY) {
        maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return rect;
  }

  return expandRect(
    {
      left: minX,
      top: minY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1),
    },
    padding,
    width,
    height
  );
}

function detectTicketLayout(sourceCanvas) {
  const imageData = getImageData(sourceCanvas);

  if (!imageData) {
    return {
      third: {
        left: 0,
        top: 0,
        width: Math.round(sourceCanvas.width / 2),
        height: Math.round(sourceCanvas.height * 0.58),
      },
      fourth: {
        left: Math.round(sourceCanvas.width / 2),
        top: 0,
        width: Math.round(sourceCanvas.width / 2),
        height: Math.round(sourceCanvas.height * 0.58),
      },
      juri: {
        left: 0,
        top: Math.round(sourceCanvas.height * 0.58),
        width: sourceCanvas.width,
        height: Math.max(1, sourceCanvas.height - Math.round(sourceCanvas.height * 0.58)),
      },
    };
  }

  const outerBounds = expandRect(
    findInkBounds(imageData, sourceCanvas.width, sourceCanvas.height),
    26,
    sourceCanvas.width,
    sourceCanvas.height
  );
  const { rowRatios, colRatios } = buildAxisDensities(imageData, outerBounds);
  const horizontalFallback = Math.round(outerBounds.height * 0.58);
  const horizontalSearchStart = Math.max(1, Math.round(outerBounds.height * 0.32));
  const horizontalSearchEnd = Math.max(
    horizontalSearchStart + 1,
    Math.round(outerBounds.height * 0.78)
  );
  const horizontalSplitOffset = findLowestDensityIndex(
    rowRatios,
    horizontalSearchStart,
    horizontalSearchEnd,
    horizontalFallback
  );
  const lowerInk = sumValues(rowRatios, horizontalSplitOffset, rowRatios.length);
  const verticalFallback = Math.round(outerBounds.width * 0.5);
  const verticalSearchStart = Math.max(1, Math.round(outerBounds.width * 0.35));
  const verticalSearchEnd = Math.max(
    verticalSearchStart + 1,
    Math.round(outerBounds.width * 0.65)
  );
  const verticalSplitOffset = findLowestDensityIndex(
    colRatios,
    verticalSearchStart,
    verticalSearchEnd,
    verticalFallback
  );
  const topHeight =
    lowerInk > 0.01
      ? Math.max(1, horizontalSplitOffset)
      : Math.max(1, Math.round(outerBounds.height * 0.58));
  const splitX = outerBounds.left + verticalSplitOffset;
  const topRect = {
    left: outerBounds.left,
    top: outerBounds.top,
    width: outerBounds.width,
    height: topHeight,
  };
  const bottomRect = {
    left: outerBounds.left,
    top: outerBounds.top + topHeight,
    width: outerBounds.width,
    height: Math.max(1, outerBounds.height - topHeight),
  };
  const thirdRect = fitRectToInk(
    imageData,
    {
      left: outerBounds.left,
      top: topRect.top,
      width: Math.max(1, splitX - outerBounds.left),
      height: topRect.height,
    },
    14
  );
  const fourthRect = fitRectToInk(
    imageData,
    {
      left: splitX,
      top: topRect.top,
      width: Math.max(1, outerBounds.left + outerBounds.width - splitX),
      height: topRect.height,
    },
    14
  );
  const juriRect = fitRectToInk(imageData, bottomRect, 14);

  return {
    third: thirdRect,
    fourth: fourthRect,
    juri: juriRect,
  };
}

function flattenOcrLines(lines = [], blocks = []) {
  if (Array.isArray(lines) && lines.length > 0) {
    return lines.map((line) => ({
      text: line && line.text ? line.text : "",
      confidence: line && typeof line.confidence === "number" ? line.confidence : 0,
      bbox: line && line.bbox ? line.bbox : null,
    }));
  }

  return blocks.flatMap((block) =>
    Array.isArray(block && block.paragraphs)
      ? block.paragraphs.flatMap((paragraph) =>
          Array.isArray(paragraph && paragraph.lines)
            ? paragraph.lines.map((line) => ({
                text: line && line.text ? line.text : "",
                confidence: line && typeof line.confidence === "number" ? line.confidence : 0,
                bbox: line && line.bbox ? line.bbox : null,
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

function emitProgress(onProgress, progress, status) {
  if (!onProgress) {
    return;
  }

  onProgress({
    progress,
    status,
  });
}

async function recognizeSection(worker, sourceCanvas, sectionKey, rectangle) {
  const config = SECTION_OCR_CONFIG[sectionKey];

  await worker.setParameters({
    tessedit_pageseg_mode: config.pageSegMode,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_char_whitelist: config.whitelist,
  });

  const response = await worker.recognize(
    sourceCanvas,
    {
      rectangle,
    },
    {
      text: true,
      blocks: true,
    }
  );
  const result = response && response.data ? response.data : {};
  const lines = flattenOcrLines(result.lines, result.blocks);

  return {
    text: result.text ? result.text : "",
    lines:
      lines.length > 0
        ? lines
        : String(result.text || "")
            .split("\n")
            .map((line) => ({
              text: line,
              confidence: typeof result.confidence === "number" ? result.confidence : 0,
              bbox: null,
            }))
            .filter((line) => line.text.trim()),
    confidence: typeof result.confidence === "number" ? result.confidence : 0,
    box: rectangle,
  };
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
  const layout = detectTicketLayout(sourceCanvas);
  const createWorker = await getTesseractCreateWorker();
  let activeSectionIndex = 0;

  emitProgress(onProgress, 0.08, "Scanning...");

  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (!message || typeof message.progress !== "number") {
        return;
      }

      const baseProgress = 0.12 + activeSectionIndex * 0.26;
      const scaledProgress = Math.min(0.96, baseProgress + message.progress * 0.22);

      emitProgress(
        onProgress,
        scaledProgress,
        `Scanning ${SECTION_OCR_CONFIG[SECTION_SCAN_ORDER[activeSectionIndex]].label}...`
      );
    },
  });

  try {
    const sections = {};

    for (let index = 0; index < SECTION_SCAN_ORDER.length; index += 1) {
      const sectionKey = SECTION_SCAN_ORDER[index];
      activeSectionIndex = index;
      emitProgress(onProgress, 0.12 + index * 0.26, `Scanning ${SECTION_OCR_CONFIG[sectionKey].label}...`);
      sections[sectionKey] = await recognizeSection(worker, sourceCanvas, sectionKey, layout[sectionKey]);
    }

    const text = SECTION_SCAN_ORDER.map((sectionKey) => sections[sectionKey].text || "").join("\n");

    emitProgress(onProgress, 1, "Scan complete");

    return {
      text,
      layout,
      sections,
    };
  } catch (error) {
    throw new Error(error && error.message ? error.message : "OCR scan failed");
  } finally {
    await worker.terminate();
  }
}
