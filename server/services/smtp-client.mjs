import net from "node:net";
import tls from "node:tls";

function onceEvent(target, event) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };
    const cleanup = () => {
      target.off(event, onEvent);
      target.off("error", onError);
    };

    target.once(event, onEvent);
    target.once("error", onError);
  });
}

function encodeBase64(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) {
        return;
      }

      const last = lines[lines.length - 1];
      if (/^\d{3}\s/.test(last)) {
        cleanup();
        const code = Number(last.slice(0, 3));
        resolve({
          code,
          message: lines.join("\n")
        });
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function sendSmtpCommand(socket, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(socket);
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP command failed (${command.split(" ")[0]}): ${response.message}`);
  }
  return response;
}

async function createSmtpSocket(config) {
  if (config.secure) {
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host
    });
    await onceEvent(socket, "secureConnect");
    return socket;
  }

  const socket = net.createConnection({
    host: config.host,
    port: config.port
  });
  await onceEvent(socket, "connect");
  return socket;
}

function buildMessage({ from, to, subject, text }) {
  const recipients = Array.isArray(to) ? to : [to];
  return [
    `From: ${from}`,
    `To: ${recipients.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text
      .replace(/\r?\n/g, "\r\n")
      .replace(/^\./gm, "..")
  ].join("\r\n");
}

export async function sendSmtpMail(config, { to, subject, text }) {
  if (!config.host || !config.port || !config.from) {
    throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.");
  }

  const recipients = Array.isArray(to) ? to : String(to || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error("No email recipient configured.");
  }

  const socket = await createSmtpSocket(config);

  try {
    const greeting = await readSmtpResponse(socket);
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting failed: ${greeting.message}`);
    }

    await sendSmtpCommand(socket, "EHLO intent-resurrection-engine", [250]);

    if (config.startTls && !config.secure) {
      throw new Error("SMTP STARTTLS upgrade is not supported in this local adapter yet. Use SMTP_SECURE=true with a TLS port such as 465.");
    }

    if (config.user && config.pass) {
      await sendSmtpCommand(socket, "AUTH LOGIN", [334]);
      await sendSmtpCommand(socket, encodeBase64(config.user), [334]);
      await sendSmtpCommand(socket, encodeBase64(config.pass), [235]);
    }

    await sendSmtpCommand(socket, `MAIL FROM:<${config.from}>`, [250]);
    for (const recipient of recipients) {
      await sendSmtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    }

    await sendSmtpCommand(socket, "DATA", [354]);
    socket.write(`${buildMessage({ from: config.from, to: recipients, subject, text })}\r\n.\r\n`);
    const dataResponse = await readSmtpResponse(socket);
    if (dataResponse.code !== 250) {
      throw new Error(`SMTP data send failed: ${dataResponse.message}`);
    }

    await sendSmtpCommand(socket, "QUIT", [221]);
    socket.end();
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
