import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Radix menus and selects call these DOM APIs, which jsdom does not implement.
if (!Element.prototype.hasPointerCapture) {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: () => false });
}
if (!Element.prototype.releasePointerCapture) {
  Object.defineProperty(Element.prototype, "releasePointerCapture", { configurable: true, value: () => {} });
}
if (!Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}
if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}
