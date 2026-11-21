const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const minify = process.argv.includes("--minify");
const options = {
    tsconfig: "./tsconfig.json",
    bundle: true,
    external: ["vscode"],
    sourcemap: minify ? false : "both",
    minify,
    watch: process.argv.includes("--watch"),
    metafile: true
};

async function build() {
    const results = await Promise.all([
        esbuild.build({
            ...options,
            entryPoints: ["src/extension.ts"],
            platform: "node",
            outfile: "dist/extension.js"
        }),
        esbuild.build({
            ...options,
            entryPoints: ["media/editor/dmiEditor.tsx"],
            platform: "browser",
            loader: { ".ttf": "file" },
            assetNames: "[name]",
            outfile: "dist/editor.js"
        })
    ]);
    const packages = new Set();
    for (const result of results) {
        for (const input of Object.keys(result.metafile.inputs)) {
            const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/);
            if (match) packages.add(match[1]);
        }
    }
    const notices = [];
    for (const dir of [...packages].sort()) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        const licenses = fs
            .readdirSync(dir)
            .filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name));
        notices.push(
            pkg.name +
                " " +
                pkg.version +
                " (" +
                JSON.stringify(pkg.license || pkg.licenses || "see package") +
                ")"
        );
        for (const name of licenses) {
            const file = path.join(dir, name);
            if (fs.statSync(file).isFile()) notices.push(fs.readFileSync(file, "utf8"));
        }
    }
    fs.writeFileSync("dist/THIRD_PARTY_NOTICES.txt", notices.join("\n\n"));
}
build().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
