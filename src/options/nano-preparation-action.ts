import type { NanoPreparation } from "../content/nano-language-detector";

export type NanoPreparationActionOptions = Readonly<{
  document: Document;
  prepare: NanoPreparation["prepare"];
  authorize(): Promise<void>;
}>;

export const installNanoPreparationAction = (options: NanoPreparationActionOptions): void => {
  const button = required(options.document, "prepare-live-chat-nano", HTMLButtonElement);
  const status = required(options.document, "nano-status", HTMLParagraphElement);
  button.addEventListener("click", () => {
    void options
      .prepare((loaded) => {
        status.textContent = `로컬 모델 준비 중: ${Math.round(loaded * 100)}%`;
      })
      .then(async (result) => {
        if (result !== "ready") {
          status.textContent = "이 기기에서는 사용할 수 없습니다";
          return;
        }
        await options.authorize();
        status.textContent = "준비됨";
      })
      .catch(() => {
        status.textContent = "이 기기에서는 사용할 수 없습니다";
      });
  });
};

const required = <ElementType extends Element>(
  document: Document,
  id: string,
  elementType: { new (): ElementType },
): ElementType => {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new TypeError(`Missing options element: ${id}`);
  return element;
};
