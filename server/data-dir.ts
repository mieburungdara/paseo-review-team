import { homedir } from "node:os";
import { join } from "node:path";
import { PLUGIN_ID } from "../shared/constants";

export function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function pluginDataDir(): string {
  return process.env.REVIEW_TEAM_DATA_DIR ?? join(paseoHome(), "plugin-data", PLUGIN_ID);
}
