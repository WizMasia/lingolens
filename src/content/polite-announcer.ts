export type PoliteAnnouncer = Readonly<{
  announce(message: string): void;
  destroy(): void;
}>;

export const createPoliteAnnouncer = (document: Document): PoliteAnnouncer => {
  const host = document.createElement("div");
  host.setAttribute("data-local-translator-ui", "announcer");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { block-size: 1px; clip-path: inset(50%); inline-size: 1px;
      overflow: hidden; position: fixed; white-space: nowrap; }
  `;
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  shadow.append(style, status);
  document.body.append(host);
  return {
    announce(message) {
      status.textContent = message;
    },
    destroy() {
      host.remove();
    },
  };
};
