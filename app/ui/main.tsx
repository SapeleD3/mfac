import { render } from "preact";
import { App } from "./app";
import { start } from "./store";
import { Widget } from "./widget";

const widget = new URLSearchParams(location.search).get("view") === "widget";
// Only the widget raises macOS notifications, so the two windows don't both ring.
start({ notifications: widget });
render(widget ? <Widget /> : <App />, document.getElementById("root")!);
