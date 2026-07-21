/**
 * Staff Item Component
 * Long magical staff with crystal top
 */

interface StaffProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  wood: '#5D4037',
  woodDark: '#3E2723',
  crystal: '#3B82F6',
  gold: '#FFD700',
};

export function Staff({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: StaffProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Main shaft */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.04, 0.65, 0.04]} />
        <meshStandardMaterial color={COLORS.wood} flatShading roughness={0.8} />
      </mesh>

      {/* Handle grip */}
      <mesh position={[0, -0.15, 0]} castShadow>
        <boxGeometry args={[0.05, 0.12, 0.05]} />
        <meshStandardMaterial color={COLORS.woodDark} flatShading roughness={0.7} />
      </mesh>

      {/* Gold ring - upper */}
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.055, 0.03, 0.055]} />
        <meshStandardMaterial color={COLORS.gold} flatShading metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Gold ring - lower */}
      <mesh position={[0, -0.08, 0]} castShadow>
        <boxGeometry args={[0.055, 0.02, 0.055]} />
        <meshStandardMaterial color={COLORS.gold} flatShading metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Crystal top */}
      <mesh position={[0, 0.48, 0]} castShadow>
        <boxGeometry args={[0.08, 0.12, 0.08]} />
        <meshStandardMaterial
          color={COLORS.crystal}
          flatShading
          emissive={COLORS.crystal}
          emissiveIntensity={0.4}
          metalness={0.2}
          roughness={0.3}
        />
      </mesh>

      {/* Crystal glow effect */}
      <mesh position={[0, 0.48, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={COLORS.crystal} transparent opacity={0.25} />
      </mesh>
    </group>
  );
}

export default Staff;
