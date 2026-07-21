/**
 * Bow Item Component
 * Wooden bow with string for archery
 */

interface BowProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  wood: '#8B4513',
  woodDark: '#654321',
  string: '#E5E5E5',
  gold: '#FFD700',
};

export function Bow({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: BowProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Main bow body - curved wood */}
      {/* Upper limb */}
      <mesh position={[0.02, 0.2, 0]} rotation={[0, 0, 0.2]} castShadow>
        <boxGeometry args={[0.04, 0.25, 0.03]} />
        <meshStandardMaterial color={COLORS.wood} flatShading roughness={0.8} />
      </mesh>

      {/* Lower limb */}
      <mesh position={[0.02, -0.2, 0]} rotation={[0, 0, -0.2]} castShadow>
        <boxGeometry args={[0.04, 0.25, 0.03]} />
        <meshStandardMaterial color={COLORS.wood} flatShading roughness={0.8} />
      </mesh>

      {/* Center grip */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.05, 0.12, 0.04]} />
        <meshStandardMaterial color={COLORS.woodDark} flatShading roughness={0.7} />
      </mesh>

      {/* Gold accents at tips */}
      <mesh position={[0.04, 0.32, 0]} castShadow>
        <boxGeometry args={[0.025, 0.03, 0.025]} />
        <meshStandardMaterial color={COLORS.gold} flatShading metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0.04, -0.32, 0]} castShadow>
        <boxGeometry args={[0.025, 0.03, 0.025]} />
        <meshStandardMaterial color={COLORS.gold} flatShading metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Bow string */}
      <mesh position={[-0.06, 0, 0]} castShadow>
        <boxGeometry args={[0.01, 0.6, 0.01]} />
        <meshStandardMaterial color={COLORS.string} flatShading roughness={0.9} />
      </mesh>
    </group>
  );
}

export default Bow;
