const DEFAULTS = {
  keep: 30,
  canvasKeep: 18,
  disableAnimations: true,
  aggressiveWhenCanvas: true
};

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("keep").value = s.keep;
  document.getElementById("canvasKeep").value = s.canvasKeep;
  document.getElementById("disableAnimations").checked = s.disableAnimations;
  document.getElementById("aggressiveWhenCanvas").checked = s.aggressiveWhenCanvas;
}

async function save() {
  const keep = Number(document.getElementById("keep").value);
  const canvasKeep = Number(document.getElementById("canvasKeep").value);
  const disableAnimations = document.getElementById("disableAnimations").checked;
  const aggressiveWhenCanvas = document.getElementById("aggressiveWhenCanvas").checked;

  await chrome.storage.sync.set({ keep, canvasKeep, disableAnimations, aggressiveWhenCanvas });

  const status = document.getElementById("status");
  status.textContent = "已儲存";
  setTimeout(() => (status.textContent = ""), 1200);
}

document.getElementById("save").addEventListener("click", save);
load();
