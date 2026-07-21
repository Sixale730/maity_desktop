/**
 * Backpack Item Component
 * Adventurer's backpack
 */

interface BackpackProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  main: '#22C55E',
  mainDark: '#16A34A',
  strap: '#8B4513',
  buckle: '#FFD700',
  pocket: '#15803D',
};

export function Backpack({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: BackpackProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Main body */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.3, 0.35, 0.15]} />
        <meshStandardMaterial color={COLORS.main} flatShading roughness={0.8} />
      </mesh>

      {/* Top flap */}
      <mesh position={[0, 0.3, 0.02]} castShadow>
        <boxGeometry args={[0.28, 0.06, 0.12]} />
        <meshStandardMaterial color={COLORS.mainDark} flatShading roughness={0.8} />
      </mesh>

      {/* Front pocket */}
      <mesh position={[0, 0.0, 0.08]} castShadow>
        <boxGeometry args={[0.2, 0.15, 0.04]} />
        <meshStandardMaterial color={COLORS.pocket} flatShading roughness={0.8} />
      </mesh>

      {/* Straps - left */}
      <mesh position={[-0.1, 0.1, 0.08]} castShadow>
        <boxGeometry args={[0.04, 0.3, 0.02]} />
        <meshStandardMaterial color={COLORS.strap} flatShading roughness={0.7} />
      </mesh>

      {/* Straps - right */}
      <mesh position={[0.1, 0.1, 0.08]} castShadow>
        <boxGeometry args={[0.04, 0.3, 0.02]} />
        <meshStandardMaterial color={COLORS.strap} flatShading roughness={0.7} />
      </mesh>

      {/* Buckle - top */}
      <mesh position={[0, 0.26, 0.09]} castShadow>
        <boxGeometry args={[0.06, 0.025, 0.02]} />
        <meshStandardMaterial color={COLORS.buckle} flatShading metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Buckle - pocket */}
      <mesh position={[0, 0.08, 0.11]} castShadow>
        <boxGeometry args={[0.04, 0.02, 0.015]} />
        <meshStandardMaterial color={COLORS.buckle} flatShading metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

export default Backpack;
