// tools/make-ico.js
const fs = require("fs");
const pngToIco = require("png-to-ico");

const SRC = "assets/icons/app.png";   // your square PNG (e.g., 512x512)
const OUT = "assets/icons/app.ico";

pngToIco([SRC])
  .then(buf => fs.promises.writeFile(OUT, buf))
  .then(() => console.log(`Wrote ${OUT}`))
  .catch(err => { console.error(err); process.exit(1); });
