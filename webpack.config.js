const path = require("path");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer")
  .BundleAnalyzerPlugin;

const ts = {
  loader: "ts-loader",
  options: { transpileOnly: false },
};
module.exports = {
  entry: { index: "./src", "sqlite.worker": "./src/sqlite.worker" },
  // mode:,
  devtool: "source-map",
  module: {
    noParse: /sql-wasm\.js/,
    rules: [
      {
        test: /\.tsx?$/,
        use: ts,
        exclude: /node_modules/,
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
    filename: "[name].js",
    publicPath: "",
    path: path.resolve(__dirname, "dist"),
    assetModuleFilename: "[name][ext]",
    library: {
      type: "umd",
    },
    globalObject: 'this',
  },
  // target: ['web', 'webworker', 'node'],
  stats: {
    children: true,
  },
  devServer: {
    publicPath: "/dist",
    hot: false,
    liveReload: false,
    https: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  plugins: process.env.analyze ? [new BundleAnalyzerPlugin()] : [],
};
