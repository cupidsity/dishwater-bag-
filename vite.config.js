import { defineConfig } from "vite";

// game.js is a plain script, not a module, so vite never sees it as part of the
// page and changes to it go unnoticed. the same goes for the sprites. this
// watches them itself and tells the browser to reload.
const reloadOnPlainFiles = {
  name: "reload-on-plain-files",
  handleHotUpdate({ file, server }) {
    const watched = [".js", ".css", ".png", ".ttf"];
    if (!watched.some((extension) => file.endsWith(extension))) return;

    server.config.logger.info(`reloading for ${file.split("/").pop()}`, { timestamp: true });
    server.ws.send({ type: "full-reload", path: "*" });
    return [];
  }
};

export default defineConfig({
  plugins: [reloadOnPlainFiles],
  server: { open: true }
});
