import { mountPatchworkApp } from "@patchwork/web-kit";
import "@patchwork/web-kit/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

mountPatchworkApp("saas", root);
