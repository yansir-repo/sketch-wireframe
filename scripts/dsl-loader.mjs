/**
 * 让草图配置写 `import { … } from "sketch-wireframe"`，不管配置放在哪个仓库、工具仓库在哪个目录：
 * 加载配置的进程注册这个 hook，把 "sketch-wireframe" 解析到本仓库的 src/shared/dsl.ts。
 * 配置因此只依赖词汇（DSL），不依赖任何路径。
 */
import { register } from "node:module";

register(new URL("./dsl-loader-hooks.mjs", import.meta.url));
