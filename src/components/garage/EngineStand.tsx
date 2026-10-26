import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box3, Color, MeshStandardMaterial, Object3D, Vector3, type Group, type Mesh, type Texture } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CONFIG_ENGINE_STAND as STAND } from "../../lib/constants";
import { engines, explodeOffset, type EngineZone } from "../../lib/engine";
import { finishes } from "../../lib/finishes";
import type { EngineId, EngineZoneId } from "../../lib/schema";
import { useConfig } from "../../lib/store";

const box = new Box3();
const center = new Vector3();
const partCenter = new Vector3();

interface ZoneMaterial {
  material: MeshStandardMaterial;
  color: Color;
  map: Texture | null;
}

interface EnginePart {
  mesh: Mesh;
  rest: Vector3;
  offset: Vector3;
  pulley: boolean;
}

function skipRaycast() {}

/** Rest positions and exploded offsets for every mesh, measured in the engine's own space. */
function measureParts(root: Object3D) {
  root.updateMatrixWorld(true);
  box.setFromObject(root).getCenter(center);
  const floor = box.min.y;
  const parts: EnginePart[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.raycast = skipRaycast;
    box.setFromObject(mesh).getCenter(partCenter);
    parts.push({
      mesh,
      rest: mesh.position.clone(),
      offset: explodeOffset(mesh.name, partCenter, center, new Vector3()),
      pulley: /^(gear|pulley)_/.test(mesh.name),
    });
  });
  return { parts, center: center.clone(), floor };
}

/** Gives each colour zone its own material, remembering the original colour and map for Factory. */
function zoneMaterials(root: Object3D, engineZones: EngineZone[]) {
  const zones = new Map<EngineZoneId, ZoneMaterial[]>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    const zone = mesh.isMesh && engineZones.find((entry) => entry.node.test(mesh.name));
    if (!zone || !(mesh.material instanceof MeshStandardMaterial)) return;
    const material = mesh.material.clone();
    mesh.material = material;
    const entry = { material, color: material.color.clone(), map: material.map };
    zones.set(zone.id, [...(zones.get(zone.id) ?? []), entry]);
  });
  return zones;
}

export function EngineStand({ engineId }: { engineId: EngineId }) {
  const definition = engines[engineId];
  const { scene } = useGLTF(definition.model);
  const root = useMemo(() => clone(scene) as Group, [scene]);
  const shake = useRef<Group>(null);
  const progress = useRef(0);
  const [spotTarget] = useState(() => new Object3D());
  const layout = useMemo(() => measureParts(root), [root]);
  const zones = useMemo(() => zoneMaterials(root, definition.zones), [definition, root]);
  const engine = useConfig((state) => state.engine);
  const exploded = useConfig((state) => state.engineExploded);
  const running = useConfig((state) => state.engineRunning);
  const revving = useConfig((state) => state.engineRevving);

  useLayoutEffect(() => {
    const finish = finishes[engine.finish];
    for (const [zone, entries] of zones) {
      const paint = engine.paints[zone] ?? definition.factoryPaints[zone];
      const factory = paint?.toLowerCase() === definition.factoryPaints[zone]?.toLowerCase();
      for (const { material, color, map } of entries) {
        // Painted colours replace the albedo texture; Factory puts the original back.
        const nextMap = factory ? map : null;
        if (material.map !== nextMap) material.needsUpdate = true;
        material.map = nextMap;
        if (factory || !paint) material.color.copy(color);
        else material.color.set(paint);
        material.roughness = finish.roughness;
        material.metalness = finish.metalness;
      }
    }
  }, [definition, engine.finish, engine.paints, zones]);

  useEffect(
    () => () => {
      for (const entries of zones.values()) entries.forEach(({ material }) => material.dispose());
    },
    [zones],
  );

  useFrame((_, delta) => {
    const target = exploded ? 1 : 0;
    progress.current += (target - progress.current) * Math.min(1, delta * 4);
    const eased = progress.current * progress.current * (3 - 2 * progress.current);
    const spin = running ? (revving ? 42 : 14) * delta : 0;

    for (const part of layout.parts) {
      part.mesh.position.copy(part.rest).addScaledVector(part.offset, eased);
      if (part.pulley) part.mesh.rotation.x += spin;
    }

    const group = shake.current;
    if (!group) return;
    const amplitude = running ? (revving ? 0.0035 : 0.0012) : 0;
    group.position.set(
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
    );
  });

  return (
    <group position={[STAND.x, 0, STAND.z]}>
      <primitive object={spotTarget} position={[0, STAND.plinth + 0.7, 0]} />
      <spotLight target={spotTarget} position={[1.6, 4.6, 2]} angle={0.45} penumbra={0.8} intensity={1.6} />
      <mesh position={[0, STAND.plinth / 2, 0]} raycast={skipRaycast}>
        <cylinderGeometry args={[0.85, 0.95, STAND.plinth, 48]} />
        <meshStandardMaterial color="#1b1c1f" roughness={0.42} metalness={0.65} envMapIntensity={0.6} />
      </mesh>
      <group position={[0, STAND.plinth, 0]} rotation={[0, definition.yaw, 0]} scale={definition.scale}>
        <group ref={shake}>
          <primitive object={root} position={[-layout.center.x, -layout.floor, -layout.center.z]} />
        </group>
      </group>
    </group>
  );
}
