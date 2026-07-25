"use strict";

(() => {
  const selectors = [
    {
      id: "qDot",
      kind: "dots",
      options: [
        ["square", "Square"],
        ["dots", "Dots"],
        ["rounded", "Rounded"],
        ["extra-rounded", "Extra rounded"],
        ["classy", "Classy"],
        ["classy-rounded", "Classy rounded"],
      ],
    },
    {
      id: "qCornerSq",
      kind: "frame",
      options: [
        ["", "Match dots"],
        ["square", "Square"],
        ["dot", "Dot"],
        ["extra-rounded", "Rounded"],
      ],
    },
    {
      id: "qCornerDot",
      kind: "center",
      options: [
        ["", "Match dots"],
        ["square", "Square"],
        ["dot", "Dot"],
      ],
    },
  ];

  const style = document.createElement("style");
  style.textContent = `
    .qr-style-native {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }
    .qr-style-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
      gap: 8px;
      margin-top: 7px;
    }
    .qr-style-choice {
      min-width: 0;
      padding: 7px 6px 6px;
      border: 1px solid var(--line, #cbc8bc);
      border-radius: 6px;
      background: var(--paper, #fff);
      color: inherit;
      font: inherit;
      cursor: pointer;
      transition: border-color .14s ease, box-shadow .14s ease, transform .14s ease;
    }
    .qr-style-choice:hover { transform: translateY(-1px); }
    .qr-style-choice[aria-pressed="true"] {
      border-color: var(--ink, #16150f);
      box-shadow: 0 0 0 2px var(--ink, #16150f);
    }
    .qr-style-choice svg {
      display: block;
      width: 100%;
      max-width: 58px;
      aspect-ratio: 1;
      margin: 0 auto 5px;
    }
    .qr-style-choice span {
      display: block;
      overflow: hidden;
      font-size: 10px;
      line-height: 1.15;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 700px) {
      .qr-style-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
  `;
  document.head.appendChild(style);

  const pattern = [
    [0, 0], [1, 0], [3, 0], [4, 0],
    [0, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [4, 2],
    [0, 3], [2, 3], [3, 3],
    [0, 4], [1, 4], [3, 4], [4, 4],
  ];

  function moduleMarkup(type, x, y, size, index) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    if (type === "dots") return `<circle cx="${cx}" cy="${cy}" r="${size * 0.42}"/>`;
    if (type === "rounded") return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.28}"/>`;
    if (type === "extra-rounded") return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.48}"/>`;
    if (type === "classy") {
      const flip = index % 2 ? -1 : 1;
      return `<path d="M${x} ${y}h${size}v${size}h-${size}z" transform="rotate(${flip * 12} ${cx} ${cy})"/>`;
    }
    if (type === "classy-rounded") {
      const flip = index % 2 ? -1 : 1;
      return `<rect x="${x + size * 0.04}" y="${y + size * 0.04}" width="${size * 0.92}" height="${size * 0.92}" rx="${size * 0.32}" transform="rotate(${flip * 12} ${cx} ${cy})"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}"/>`;
  }

  function dotPreview(type) {
    const size = 8;
    const gap = 2;
    const offset = 5;
    const modules = pattern.map(([column, row], index) => {
      const x = offset + column * (size + gap);
      const y = offset + row * (size + gap);
      return moduleMarkup(type, x, y, size, index);
    }).join("");
    return `<svg viewBox="0 0 60 60" aria-hidden="true"><g fill="currentColor">${modules}</g></svg>`;
  }

  function framePreview(type) {
    const radius = type === "dot" ? 14 : type === "extra-rounded" ? 8 : 0;
    const match = type === "";
    return `<svg viewBox="0 0 60 60" aria-hidden="true">`
      + `<rect x="8" y="8" width="44" height="44" rx="${radius}" fill="currentColor" opacity="${match ? ".28" : "1"}"/>`
      + `<rect x="16" y="16" width="28" height="28" rx="${type === "dot" ? 9 : type === "extra-rounded" ? 5 : 0}" fill="var(--paper,#fff)"/>`
      + `<rect x="24" y="24" width="12" height="12" rx="${type === "dot" ? 6 : 0}" fill="currentColor"/>`
      + (match ? '<path d="M11 49 49 11" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' : "")
      + `</svg>`;
  }

  function centerPreview(type) {
    const match = type === "";
    const radius = type === "dot" ? 14 : 0;
    return `<svg viewBox="0 0 60 60" aria-hidden="true">`
      + '<rect x="7" y="7" width="46" height="46" rx="7" fill="none" stroke="currentColor" stroke-width="6"/>'
      + `<rect x="21" y="21" width="18" height="18" rx="${radius}" fill="currentColor" opacity="${match ? ".35" : "1"}"/>`
      + (match ? '<path d="M13 47 47 13" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' : "")
      + `</svg>`;
  }

  function preview(kind, value) {
    if (kind === "dots") return dotPreview(value);
    if (kind === "frame") return framePreview(value);
    return centerPreview(value);
  }

  function enhance({ id, kind, options }) {
    const select = document.querySelector(`#${id}`);
    if (!select || select.dataset.visualPicker === "true") return;
    select.dataset.visualPicker = "true";
    select.classList.add("qr-style-native");

    const grid = document.createElement("div");
    grid.className = "qr-style-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", select.closest("label")?.querySelector("span")?.textContent?.trim() || "QR style");

    function sync() {
      grid.querySelectorAll("button").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.value === select.value));
      });
    }

    options.forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "qr-style-choice";
      button.dataset.value = value;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = preview(kind, value) + `<span>${label}</span>`;
      button.addEventListener("click", () => {
        select.value = value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
      });
      grid.appendChild(button);
    });

    select.insertAdjacentElement("afterend", grid);
    select.addEventListener("input", sync);
    select.addEventListener("change", sync);
    sync();
  }

  selectors.forEach(enhance);
})();
