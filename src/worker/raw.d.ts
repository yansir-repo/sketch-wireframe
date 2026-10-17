// Vite's `?raw` imports: the format guide is bundled as text.
declare module "*.md?raw" {
  const text: string;
  export default text;
}
declare module "*.txt?raw" {
  const text: string;
  export default text;
}
declare module "*.ts?raw" {
  const text: string;
  export default text;
}
