const DSL = new URL("../src/shared/dsl.ts", import.meta.url).href;

export const resolve = (specifier, context, next) =>
  specifier === "sketch-wireframe" ? { url: DSL, shortCircuit: true } : next(specifier, context);
