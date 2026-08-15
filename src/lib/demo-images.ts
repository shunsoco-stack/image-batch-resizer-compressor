const DEMO_PALETTES = [
  ["#E8B7A0", "#9B5B44", "#FFF4EC"],
  ["#9DC8C8", "#236A6B", "#E9FBF7"],
  ["#C7B3E5", "#65508B", "#F6F0FF"],
  ["#E7C168", "#8F6720", "#FFF9E8"],
  ["#9BB9EA", "#315B9B", "#EEF5FF"],
  ["#DF9AAF", "#903E59", "#FFF0F4"],
  ["#A7CE91", "#467338", "#F3FBEF"],
  ["#E39B76", "#994929", "#FFF3ED"],
  ["#A7AEBE", "#404B61", "#F2F4F8"],
  ["#78C7BD", "#196C64", "#E9FCF8"],
] as const;

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

async function canvasToFile(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("デモ画像を生成できませんでした。")), "image/png");
  });
  return new File([blob], name, { type: "image/png", lastModified: 0 });
}

export async function createDemoFiles(): Promise<File[]> {
  const files: File[] = [];
  for (let index = 0; index < DEMO_PALETTES.length; index += 1) {
    const [accent, dark, paper] = DEMO_PALETTES[index];
    const canvas = document.createElement("canvas");
    canvas.width = index % 3 === 1 ? 2400 : 2200;
    canvas.height = index % 3 === 2 ? 2500 : 2200;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvasを利用できません。");

    const width = canvas.width;
    const height = canvas.height;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, paper);
    gradient.addColorStop(1, accent);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.globalAlpha = 0.18;
    context.fillStyle = dark;
    context.beginPath();
    context.arc(width * 0.82, height * 0.16, width * 0.23, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(width * 0.08, height * 0.88, width * 0.3, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;

    context.save();
    context.shadowColor = "rgba(35, 29, 27, .22)";
    context.shadowBlur = 46;
    context.shadowOffsetY = 30;
    roundedRect(context, width * 0.27, height * 0.22, width * 0.46, height * 0.58, width * 0.07);
    context.fillStyle = "rgba(255,255,255,.9)";
    context.fill();
    context.restore();

    roundedRect(context, width * 0.34, height * 0.13, width * 0.32, height * 0.16, width * 0.04);
    context.fillStyle = dark;
    context.fill();

    const bottle = context.createLinearGradient(width * 0.3, 0, width * 0.7, 0);
    bottle.addColorStop(0, "rgba(255,255,255,.95)");
    bottle.addColorStop(0.45, accent);
    bottle.addColorStop(1, "rgba(255,255,255,.82)");
    roundedRect(context, width * 0.28, height * 0.25, width * 0.44, height * 0.56, width * 0.065);
    context.fillStyle = bottle;
    context.fill();

    roundedRect(context, width * 0.34, height * 0.45, width * 0.32, height * 0.21, width * 0.018);
    context.fillStyle = "rgba(255,255,255,.74)";
    context.fill();

    context.fillStyle = dark;
    context.textAlign = "center";
    context.font = `700 ${Math.round(width * 0.035)}px -apple-system, system-ui, sans-serif`;
    context.fillText("STUDIO", width * 0.5, height * 0.52);
    context.font = `500 ${Math.round(width * 0.019)}px -apple-system, system-ui, sans-serif`;
    context.fillText(`ESSENTIAL  ${String(index + 1).padStart(2, "0")}`, width * 0.5, height * 0.57);
    context.font = `600 ${Math.round(width * 0.025)}px -apple-system, system-ui, sans-serif`;
    context.fillText(["SERUM", "LOTION", "MIST", "CREAM"][index % 4], width * 0.5, height * 0.62);

    context.fillStyle = "rgba(255,255,255,.75)";
    roundedRect(context, width * 0.06, height * 0.06, width * 0.19, height * 0.065, width * 0.032);
    context.fill();
    context.fillStyle = dark;
    context.textAlign = "left";
    context.font = `650 ${Math.round(width * 0.018)}px -apple-system, system-ui, sans-serif`;
    context.fillText(`PRODUCT ${String(index + 1).padStart(2, "0")}`, width * 0.085, height * 0.102);

    files.push(await canvasToFile(canvas, `demo-product-${String(index + 1).padStart(2, "0")}.png`));
    canvas.width = 1;
    canvas.height = 1;
  }
  return files;
}
