const path = require("path");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer")
  .BundleAnalyzerPlugin;

const ts = {
  loader: "ts-loader",
  options: { transpileOnly: false },
};
module.exports = {
  entry: "./src/db",
  // mode:,
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
    assetModuleFilename: "[name]-[hash][ext][query]",
    library: {
      type: "umd"
    }
  },
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
    }
  },
  plugins: process.env.analyze ? [new BundleAnalyzerPlugin()]: [],
};
