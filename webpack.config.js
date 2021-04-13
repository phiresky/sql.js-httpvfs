const path = require("path");

const ts = {
  loader: "ts-loader",
  options: { transpileOnly: true },
};
module.exports = {
  entry: "./src",
  mode: "development",
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: ts,
        exclude: /node_modules/,
      },
      {
        test: /\.worker.ts$/,
        use: [{ loader: "worker-loader" }, ts],
      },
      { test: /\.wasm$/, type: "asset/resource" },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    fallback: {
      fs: false,
      crypto: false,
      path: false,
    },
  },
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist"),
  },
  stats: {
    children: true,
  },
  devServer: {
    hot: false,
    liveReload: false,
  },
};
