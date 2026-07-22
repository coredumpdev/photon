// Bundled JSON assets are typed opaquely so tsc doesn't parse the (multi-MB)
// literal to infer a type — esbuild still inlines the real data at build time.
declare module "*.json" {
  const value: unknown;
  export default value;
}
