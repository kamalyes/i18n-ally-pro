const path = require('path')
const webpack = require('webpack')

module.exports = {
  target: 'node',
  mode: 'production',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    clean: true,
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^playwright$/ }),
    new webpack.IgnorePlugin({ resourceRegExp: /^playwright-core$/ }),
  ],
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '~': path.resolve(__dirname, 'src'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                declaration: false,
                declarationMap: false,
              },
            },
          },
        ],
      },
    ],
  },
  optimization: {
    minimize: false,
    usedExports: true,
    sideEffects: true,
  },
  devtool: 'nosources-source-map',
}
