/**
 * Queue drawer (desktop) / bottom sheet (mobile) for the site player.
 * Shows now playing + up next. Up-next rows can be reordered by dragging the
 * handle (mouse or touch) or with the up/down buttons, removed, or clicked to jump.
 */

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function smallButton(text, label, className) {
  const btn = el("button", `player-queue__icon-btn ${className}`, { type: "button", "aria-label": label, title: label });
  btn.textContent = text;
  return btn;
}

/**
 * @param {{ title: string, artist?: string }} track
 * @param {{ current: boolean, first?: boolean, last?: boolean }} opts
 */
function buildRow(track, { current, first = false, last = false }) {
  const li = el("li", `player-queue__item${current ? " player-queue__item--current" : ""}`);
  li.dataset.id = track.id;
  const jump = el("button", "player-queue__jump", { type: "button" });
  jump.setAttribute("aria-label", current ? `Now playing: ${track.title}` : `Play ${track.title}`);
  const title = el("span", "player-queue__title");
  title.textContent = track.title;
  const artist = el("span", "player-queue__artist");
  artist.textContent = track.artist ?? "NXGRXVITY";
  jump.append(title, artist);
  if (current) {
    li.append(jump);
    return li;
  }
  const handle = el("span", "player-queue__handle", { "aria-hidden": "true", title: "Drag to reorder" });
  handle.textContent = "⋮⋮";
  const up = smallButton("↑", `Move ${track.title} up`, "player-queue__up");
  const down = smallButton("↓", `Move ${track.title} down`, "player-queue__down");
  const remove = smallButton("✕", `Remove ${track.title} from queue`, "player-queue__remove");
  up.disabled = first;
  down.disabled = last;
  li.append(handle, jump, up, down, remove);
  return li;
}

/**
 * Pointer drag on `.player-queue__handle` inside `list`. Calls onDrop(fromIdx, toIdx)
 * with indices into the list's rows.
 */
function enableDragReorder(list, onDrop) {
  let drag = null;
  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest?.(".player-queue__handle");
    if (!handle) return;
    const row = handle.closest("li");
    const rows = Array.from(list.children);
    drag = { row, from: rows.indexOf(row), startY: e.clientY, rects: rows.map((r) => r.getBoundingClientRect()) };
    row.classList.add("player-queue__item--dragging");
    try { handle.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    e.preventDefault();
  });
  list.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.row.style.transform = `translateY(${e.clientY - drag.startY}px)`;
  });
  const end = (e) => {
    if (!drag) return;
    const { row, from, rects } = drag;
    drag = null;
    row.classList.remove("player-queue__item--dragging");
    row.style.transform = "";
    if (e.type === "pointercancel") return;
    const to = dropIndexForY(rects, e.clientY);
    if (to !== from) onDrop(from, to);
  };
  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);
}

/** Index of the row whose vertical middle the pointer passed last. */
export function dropIndexForY(rects, y) {
  let idx = 0;
  for (let i = 0; i < rects.length; i++) {
    if (y > rects[i].top + rects[i].height / 2) idx = i;
  }
  if (rects.length > 0 && y < rects[0].top + rects[0].height / 2) idx = 0;
  return idx;
}

/** Rows re-render after a move; keep keyboard focus on the same button of the same track. */
function refocusMovedButton(root, id, btnClass) {
  if (!btnClass || !id) return;
  const row = Array.from(root.querySelectorAll(".player-queue__item")).find((r) => r.dataset.id === id);
  const btn = row?.querySelector(`.${btnClass}`);
  if (btn && !btn.disabled) btn.focus({ preventScroll: true });
  else row?.querySelector(".player-queue__jump")?.focus({ preventScroll: true });
}

function buildShell(onClose) {
  const root = el("aside", "player-queue", { role: "dialog", "aria-label": "Queue", "aria-modal": "false" });
  root.hidden = true;
  const header = el("div", "player-queue__header");
  const grab = el("div", "player-queue__grab", { "aria-hidden": "true" });
  const h = el("h2", "player-queue__heading");
  h.textContent = "Queue";
  const close = smallButton("✕", "Close queue", "player-queue__close");
  close.addEventListener("click", onClose);
  header.append(grab, h, close);
  const nowLabel = el("h3", "player-queue__label");
  nowLabel.textContent = "Now playing";
  const now = el("ol", "player-queue__list player-queue__list--now");
  const nextLabel = el("h3", "player-queue__label");
  nextLabel.textContent = "Up next";
  const list = el("ol", "player-queue__list player-queue__list--next");
  const empty = el("p", "player-queue__empty");
  empty.textContent = "Nothing queued.";
  root.append(header, nowLabel, now, nextLabel, list, empty);
  return { root, now, list, empty, close };
}

/**
 * @param {{ onJump: (id: string) => void, onRemove: (id: string) => void,
 *   onMove: (fromUpNext: number, toUpNext: number) => void, onClose: () => void }} handlers
 */
export function createQueuePanel(handlers) {
  const shell = buildShell(() => handlers.onClose());
  enableDragReorder(shell.list, (from, to) => handlers.onMove(from, to));

  shell.root.addEventListener("click", (e) => {
    const row = e.target.closest?.(".player-queue__item");
    if (!row) return;
    const id = row.dataset.id;
    const upNext = Array.from(shell.list.children);
    const i = upNext.indexOf(row);
    if (e.target.closest(".player-queue__remove")) handlers.onRemove(id);
    else if (e.target.closest(".player-queue__up")) handlers.onMove(i, i - 1);
    else if (e.target.closest(".player-queue__down")) handlers.onMove(i, i + 1);
    else if (e.target.closest(".player-queue__jump")) handlers.onJump(id);
    refocusMovedButton(shell.root, id, e.target.closest("button")?.classList[1]);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !shell.root.hidden) handlers.onClose();
  });

  return {
    root: shell.root,
    isOpen: () => !shell.root.hidden,
    setOpen(open) {
      shell.root.hidden = !open;
      if (open) shell.close.focus({ preventScroll: true });
    },
    /** @param {{ current: object | null, upNext: object[] }} q */
    render({ current, upNext }) {
      shell.now.replaceChildren(...(current ? [buildRow(current, { current: true })] : []));
      shell.list.replaceChildren(
        ...upNext.map((t, i) => buildRow(t, { current: false, first: i === 0, last: i === upNext.length - 1 })),
      );
      shell.empty.hidden = upNext.length > 0;
    },
  };
}
