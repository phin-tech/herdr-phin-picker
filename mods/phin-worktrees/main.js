// Opens the picker on the branches of the repo in focus. It's its own mod
// because mod.open passes no props, so a key can't ask the picker for this.

import { View, div } from "gpui-kit";
import { closeOverlay, openOverlay, props } from "herdr";

export default class Worktrees extends View {
  init(_props, cx) {
    cx.timer.after(0, () => {
      closeOverlay(props().overlay);
      openOverlay({ mod: "phin-picker", props: { start: "branches" }, kind: "popup", at: "top", offset: 40, width: 760, height: 0.7 });
    });
  }

  render() {
    return div();
  }
}
