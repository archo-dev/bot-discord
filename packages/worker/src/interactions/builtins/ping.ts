import { message } from "../respond.js";
import type { BuiltinHandler } from "./index.js";

export const pingHandler: BuiltinHandler = async () => {
  return message("🏓 Pong !");
};
