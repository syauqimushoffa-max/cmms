import { plantLabels, type PlantId } from "@pbs-cmms/shared";
import { selectedPlant, setSelectedPlant } from "../api/client";
import { useCurrentUser } from "../state/UserContext";

type PlantSelectorProps = {
  allowCombined?: boolean;
  compact?: boolean;
};

export function PlantSelector({ allowCombined = false, compact = false }: PlantSelectorProps) {
  const { currentUser, loadingUsers } = useCurrentUser();
  if (loadingUsers || !currentUser) return null;
  const plants: PlantId[] = currentUser.plantAccess === "both"
    ? ["port-klang", "sendayan"] : [currentUser.plantAccess];
  const combined = allowCombined && currentUser.plantAccess === "both";
  const value = selectedPlant();
  return <div className={compact ? "plant-selector plant-selector-compact" : "plant-selector"}>
    <label htmlFor="plant-scope">Plant</label>
    <select id="plant-scope" value={value} disabled={plants.length === 1} onChange={(event) => {
      setSelectedPlant(event.target.value as PlantId | "all");
      window.location.reload();
    }}>
      {plants.map((plant) => <option key={plant} value={plant}>{plantLabels[plant]}</option>)}
      {combined && <option value="all">Both plants</option>}
    </select>
    {!compact && <span>{value === "all" ? "Combined reporting" : "Work orders, spare parts and PM will use this plant"}</span>}
  </div>;
}
