import { AsyncLocalStorage } from "node:async_hooks";
import type { PlantId, User } from "@pbs-cmms/shared";

export const plantContext = new AsyncLocalStorage<{ plant: PlantId | "all" }>();
export function canAccessPlant(plant: unknown) {
  const scope = plantContext.getStore();
  return !scope || scope.plant === "all" || scope.plant === plant;
}
export function writePlant(): PlantId {
  const plant = plantContext.getStore()?.plant ?? "port-klang";
  if (plant === "all") throw new Error("Select one plant before making changes.");
  return plant;
}
export function userPlants(user: Pick<User, "plantAccess">): PlantId[] {
  return user.plantAccess === "both" ? ["port-klang", "sendayan"] : [user.plantAccess];
}
export function plantSettingKey(key: string) {
  return writePlant() === "port-klang" ? key : `sendayan:${key}`;
}
