/// <reference types="vite/client" />

declare module "*.vtt?raw" {
  const content: string;
  export default content;
}
