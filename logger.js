const fs = require("fs");
const path = require("path");
const util = require("util");

const logDirectory = path.join(__dirname, "log");

// Create log directory if it doesn't exist
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}

// Create a timestamped log file
const getTimestamp = () => {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-");
};

const logFileName = `log_${getTimestamp()}.log`;
const logFilePath = path.join(logDirectory, logFileName);

// Create a writable stream for logging
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

/**
 * Asynchronously logs messages to a timestamped file.
 * @param {any} data - The data to be logged. Can be a string or an object.
 */
const log = (data) => {
  const timestamp = new Date().toISOString();
  let logMessage;

  if (typeof data === "string") {
    logMessage = `${timestamp} - ${data}\n`;
  } else {
    logMessage = `${timestamp} - ${util.inspect(data, {
      showHidden: false,
      depth: null,
      colors: false,
    })}\n`;
  }

  logStream.write(logMessage);
};

module.exports = { log };
