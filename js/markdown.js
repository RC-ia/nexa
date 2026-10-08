/**
 * Renderização markdown + realce de código
 * Gerado por refatoração de script.js — comportamento preservado.
 */
export const md = window.markdownit
  ? window.markdownit({
      html: false,
      linkify: true,
      typographer: true,
      highlight: function (str, lang) {
        if (lang && window.hljs && window.hljs.getLanguage(lang)) {
          try {
            return (
              '<pre class="hljs"><code>' +
              window.hljs.highlight(str, { language: lang, ignoreIllicits: true }).value +
              "</code></pre>"
            );
          } catch (__) {}
        }
        return (
          '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + "</code></pre>"
        );
      },
    })
  : null;


if (md) {
  const renderImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const source = token.attrGet("src") || "";
    if (!source.startsWith("/generated/")) {
      const alt = md.utils.escapeHtml(token.content || "conteúdo visual");
      return `<span>Imagem omitida fora do modo Criar imagem: ${alt}</span>`;
    }
    return renderImage(tokens, index, options, env, renderer);
  };
}


(function loadHighlightJS() {
  if (window.hljs) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/atom-one-dark.min.css";
  document.head.appendChild(link);
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js";
  script.onload = () => window.hljs.highlightAll();
  document.head.appendChild(script);
})();



