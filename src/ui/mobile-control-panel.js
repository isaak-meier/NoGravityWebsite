/**
 * On mobile, collapse bottom-left HUD controls behind a single toggle button.
 * @param {HTMLElement} bottomHud — `.bottom-left-hud` root
 * @param {boolean} isMobile
 * @returns {HTMLElement} mount target for screen-dials, song picker, lil-gui, etc.
 */
export function attachMobileControlPanel(bottomHud, isMobile) {
  if (!isMobile) return bottomHud;

  bottomHud.classList.add("bottom-left-hud--collapsible");

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "cockpit-control-panel-btn";
  toggleBtn.textContent = "Control panel";
  toggleBtn.setAttribute("aria-label", "Show or hide performance and audio controls");
  toggleBtn.setAttribute("aria-expanded", "false");

  const drawer = document.createElement("div");
  drawer.className = "bottom-left-hud__drawer";
  drawer.id = "mobile-control-panel-drawer";
  drawer.hidden = true;
  toggleBtn.setAttribute("aria-controls", drawer.id);

  toggleBtn.addEventListener("click", () => {
    const open = drawer.hidden;
    drawer.hidden = !open;
    toggleBtn.classList.toggle("cockpit-control-panel-btn--open", open);
    toggleBtn.setAttribute("aria-expanded", String(open));
    bottomHud.classList.toggle("bottom-left-hud--drawer-open", open);
  });

  bottomHud.appendChild(toggleBtn);
  bottomHud.appendChild(drawer);
  return drawer;
}
