const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const {
  createSeller,
  createTicket,
  DEFAULT_DB,
  normalizeSeller,
  normalizeTicket,
  updateSeller,
  updateTicket,
} = require("./lib/models");
const {
  buildAdminOverview,
  buildRangeReportMetrics,
  buildRiskBoard,
  buildSellerReport,
} = require("./lib/reports");
const {
  getDb,
  updateDb,
} = require("./lib/store");

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";
const BUILD_DIR = path.join(__dirname, "..", "build");
const STATIC_DIR = path.join(BUILD_DIR, "static");

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "lottery-control-backend",
        time: new Date().toISOString(),
      });
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const db = getDb();
      const role = String(body.role || "").toLowerCase();
      const username = String(body.username || "").trim();
      const password = String(body.password || "").trim();

      if (role === "admin") {
        if (
          username === db.admin.username &&
          password === db.admin.password
        ) {
          return sendJson(res, 200, {
            ok: true,
            session: {
              role: "admin",
              username: db.admin.username,
            },
          });
        }
      }

      if (role === "seller") {
        const seller = db.sellers.find(
          (item) =>
            item.active &&
            item.username.toLowerCase() === username.toLowerCase() &&
            item.password === password
        );

        if (seller) {
          return sendJson(res, 200, {
            ok: true,
            session: {
              role: "seller",
              username: seller.username,
              sellerId: seller.id,
              sellerName: seller.name,
            },
          });
        }
      }

      return sendJson(res, 401, {
        ok: false,
        message: "Invalid login",
      });
    }

    if (req.method === "GET" && pathname === "/api/bootstrap") {
      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        admin: { username: db.admin.username },
        sellers: db.sellers,
        settings: db.settings,
      });
    }

    if (pathname === "/api/sellers" && req.method === "GET") {
      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        sellers: db.sellers,
      });
    }

    if (pathname === "/api/sellers" && req.method === "POST") {
      const body = await readJsonBody(req);
      const db = updateDb((current) => {
        current.sellers.push(createSeller(body, current.sellers));
        return current;
      });

      return sendJson(res, 201, {
        ok: true,
        sellers: db.sellers,
      });
    }

    if (pathname.startsWith("/api/sellers/") && req.method === "PATCH") {
      const sellerId = extractId(pathname, "/api/sellers/");
      const body = await readJsonBody(req);

      const db = updateDb((current) => {
        current.sellers = current.sellers.map((seller) =>
          String(seller.id) === sellerId ? updateSeller(seller, body) : seller
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        sellers: db.sellers,
      });
    }

    if (pathname === "/api/tickets" && req.method === "GET") {
      const db = getDb();
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");
      const sellerUsername = requestUrl.searchParams.get("sellerUsername");

      let tickets = db.tickets;

      if (date) {
        tickets = tickets.filter((ticket) => ticket.date === date);
      }

      if (drawTime) {
        tickets = tickets.filter((ticket) => ticket.drawTime === drawTime);
      }

      if (sellerUsername) {
        tickets = tickets.filter(
          (ticket) =>
            String(ticket.sellerUsername || "").toLowerCase() ===
            sellerUsername.toLowerCase()
        );
      }

      return sendJson(res, 200, {
        ok: true,
        tickets,
      });
    }

    if (pathname === "/api/tickets" && req.method === "POST") {
      const body = await readJsonBody(req);
      const db = updateDb((current) => {
        current.tickets.unshift(createTicket(body));
        return current;
      });

      return sendJson(res, 201, {
        ok: true,
        tickets: db.tickets,
      });
    }

    if (pathname.startsWith("/api/tickets/") && req.method === "PATCH") {
      const ticketId = extractId(pathname, "/api/tickets/");
      const body = await readJsonBody(req);

      const db = updateDb((current) => {
        current.tickets = current.tickets.map((ticket) =>
          String(ticket.id) === ticketId ? updateTicket(ticket, body) : ticket
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        tickets: db.tickets,
      });
    }

    if (pathname === "/api/results" && req.method === "GET") {
      const db = getDb();
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");

      let results = db.results;

      if (date) {
        results = results.filter((result) => result.date === date);
      }

      if (drawTime) {
        results = results.filter((result) => result.drawTime === drawTime);
      }

      return sendJson(res, 200, {
        ok: true,
        results,
      });
    }

    if (pathname === "/api/results" && req.method === "PUT") {
      const body = await readJsonBody(req);
      const result = {
        date: String(body.date || ""),
        drawTime: String(body.drawTime || ""),
        winningNumber: String(body.winningNumber || "").replace(/[^\d]/g, "").slice(0, 2),
        updatedAt: new Date().toISOString(),
      };

      if (!result.date || !result.drawTime || result.winningNumber.length !== 2) {
        return sendJson(res, 400, {
          ok: false,
          message: "date, drawTime and 2 digit winningNumber are required",
        });
      }

      const db = updateDb((current) => {
        const index = current.results.findIndex(
          (item) => item.date === result.date && item.drawTime === result.drawTime
        );

        if (index >= 0) {
          current.results[index] = result;
        } else {
          current.results.push(result);
        }

        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        results: db.results,
      });
    }

    if (pathname === "/api/results" && req.method === "DELETE") {
      const date = String(requestUrl.searchParams.get("date") || "");
      const drawTime = String(requestUrl.searchParams.get("drawTime") || "");

      if (!date || !drawTime) {
        return sendJson(res, 400, {
          ok: false,
          message: "date and drawTime are required",
        });
      }

      const db = updateDb((current) => {
        current.results = current.results.filter(
          (item) => !(item.date === date && item.drawTime === drawTime)
        );
        return current;
      });

      return sendJson(res, 200, {
        ok: true,
        results: db.results,
      });
    }

    if (pathname === "/api/dashboard/overview" && req.method === "GET") {
      const db = getDb();
      return sendJson(res, 200, {
        ok: true,
        overview: buildAdminOverview(db.tickets, db.results),
      });
    }

    if (pathname === "/api/dashboard/risk" && req.method === "GET") {
      const db = getDb();
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");
      const tickets = db.tickets.filter((ticket) => {
        if (date && ticket.date !== date) {
          return false;
        }

        if (drawTime && ticket.drawTime !== drawTime) {
          return false;
        }

        return !ticket.cancelled;
      });

      return sendJson(res, 200, {
        ok: true,
        riskBoard: buildRiskBoard(tickets),
      });
    }

    if (pathname === "/api/reports/seller" && req.method === "GET") {
      const db = getDb();
      const sellerUsername = requestUrl.searchParams.get("sellerUsername");
      const date = requestUrl.searchParams.get("date");
      const drawTime = requestUrl.searchParams.get("drawTime");

      if (!sellerUsername) {
        return sendJson(res, 400, {
          ok: false,
          message: "sellerUsername is required",
        });
      }

      const seller = db.sellers.find(
        (item) => item.username.toLowerCase() === sellerUsername.toLowerCase()
      );

      const tickets = db.tickets.filter((ticket) => {
        if (
          String(ticket.sellerUsername || "").toLowerCase() !==
          sellerUsername.toLowerCase()
        ) {
          return false;
        }

        if (date && ticket.date !== date) {
          return false;
        }

        if (drawTime && drawTime !== "ALL" && ticket.drawTime !== drawTime) {
          return false;
        }

        return !ticket.cancelled;
      });

      return sendJson(res, 200, {
        ok: true,
        report: buildSellerReport(seller, tickets, db.results, {
          date,
          drawTime,
        }),
      });
    }

    if (pathname === "/api/reports/summary" && req.method === "GET") {
      const db = getDb();
      const range = String(requestUrl.searchParams.get("range") || "Daily");
      const today = String(requestUrl.searchParams.get("today") || "");
      const sellerUsername = String(requestUrl.searchParams.get("sellerUsername") || "");

      if (!today) {
        return sendJson(res, 400, {
          ok: false,
          message: "today is required",
        });
      }

      return sendJson(res, 200, {
        ok: true,
        report: buildRangeReportMetrics(db.tickets, db.results, range, today, sellerUsername),
      });
    }

    if ((req.method === "GET" || req.method === "HEAD") && shouldServeStatic(pathname)) {
      return serveStaticAsset(res, pathname, req.method);
    }

    if ((req.method === "GET" || req.method === "HEAD") && hasBuildIndex()) {
      return serveIndexHtml(res, req.method);
    }

    return sendJson(res, 404, {
      ok: false,
      message: "Route not found",
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      message: error.message || "Server error",
    });
  }
});

server.listen(PORT, HOST, () => {
  const db = getDb();
  console.log(`Lottery backend running on http://localhost:${PORT}`);
  getNetworkAddresses().forEach((address) => {
    console.log(`Lottery backend running on http://${address}:${PORT}`);
  });
  console.log(`Loaded ${db.sellers.length} seller(s), ${db.tickets.length} ticket(s), ${db.results.length} result(s)`);
});

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function extractId(pathname, prefix) {
  return pathname.slice(prefix.length).split("/")[0];
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = new Set();

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal || entry.family !== "IPv4") {
        return;
      }

      addresses.add(entry.address);
    });
  });

  return [...addresses];
}

function hasBuildIndex() {
  return fs.existsSync(path.join(BUILD_DIR, "index.html"));
}

function shouldServeStatic(pathname) {
  return pathname === "/" || pathname.startsWith("/static/") || pathname.endsWith(".json") || pathname.endsWith(".ico") || pathname.endsWith(".png") || pathname.endsWith(".svg") || pathname.endsWith(".txt") || pathname.endsWith(".js") || pathname.endsWith(".css");
}

function serveStaticAsset(res, pathname, method = "GET") {
  if (!hasBuildIndex()) {
    return sendJson(res, 404, {
      ok: false,
      message: "Frontend build not found",
    });
  }

  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const safeRelativePath = normalizedPath.replace(/^\/+/, "");
  const filePath = path.join(BUILD_DIR, safeRelativePath);

  if (!filePath.startsWith(BUILD_DIR)) {
    return sendJson(res, 400, {
      ok: false,
      message: "Invalid file path",
    });
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (pathname === "/") {
      return serveIndexHtml(res);
    }

    return sendJson(res, 404, {
      ok: false,
      message: "File not found",
    });
  }

  const contentType = getContentType(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
  });

  if (method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

function serveIndexHtml(res, method = "GET") {
  const filePath = path.join(BUILD_DIR, "index.html");

  if (!fs.existsSync(filePath)) {
    return sendJson(res, 404, {
      ok: false,
      message: "Frontend build not found",
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
  });

  if (method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }

  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".ico") {
    return "image/x-icon";
  }

  if (extension === ".txt") {
    return "text/plain; charset=utf-8";
  }

  return "application/octet-stream";
}

if (typeof DEFAULT_DB !== "undefined") {
  void DEFAULT_DB;
}
