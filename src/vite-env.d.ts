/// <reference types="vite/client" />

declare module '*.css';
declare module '*.otf?inline' {
  const dataUrl: string;
  export default dataUrl;
}
declare module '*.woff?inline' {
  const dataUrl: string;
  export default dataUrl;
}
declare module '*.ttf?inline' {
  const dataUrl: string;
  export default dataUrl;
}
