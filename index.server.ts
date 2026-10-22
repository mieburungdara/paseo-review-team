import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  leadSendRpc,
  requestReportRpc,
  sessionRefreshRpc,
  sessionStartRpc,
  sessionStopRpc,
  stateGetRpc,
  toolsEnableRpc,
} from "./shared/contracts";
import { registerObserver } from "./server/observer";
import {
  enableTools,
  getState,
  refreshSession,
  requestReport,
  sendLeadMessage,
  startSession,
  stopSession,
} from "./server/service";

export default function contribute(server: PluginServerContext) {
  server.handle(stateGetRpc, getState);
  server.handle(toolsEnableRpc, enableTools);
  server.handle(sessionStartRpc, startSession);
  server.handle(sessionRefreshRpc, refreshSession);
  server.handle(sessionStopRpc, stopSession);
  server.handle(leadSendRpc, sendLeadMessage);
  server.handle(requestReportRpc, requestReport);

  const disposeObserver = registerObserver(server);

  return () => {
    disposeObserver();
  };
}
