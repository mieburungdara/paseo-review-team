import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReviewTeamPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "review-team",
    title: "Review Team",
    icon: "Users",
    context: "workspace",
    Component: ReviewTeamPanel,
  });

  const removeCommand = client.addCommandCenterItem({
    id: "review-team.open",
    title: "Buka Review Team",
    icon: "Users",
    keywords: ["review", "reviewer", "team", "multi-agent", "lensa"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("review-team");
    },
  });

  return () => {
    removePanel();
    removeCommand();
  };
}
