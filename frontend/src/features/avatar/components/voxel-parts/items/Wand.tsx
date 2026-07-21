/**
 * Wand Item Component
 * Magic wand with glowing tip
 */

interface WandProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  wood: '#4A3728',       // Dark wood
  tip: '#9333EA',        // Purple magic tip
  glow: '#9333EA',       // Purple glow
  accent: '#FFD700',     // Gold accent
};

export function Wand({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: WandProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Main wand shaft */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.04, 0.35, 0.04]} />
        <meshStandardMaterial
          color={COLORS.wood}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Handle grip */}
      <mesh position={[0, -0.12, 0]} castShadow>
        <boxGeometry args={[0.05, 0.12, 0.05]} />
        <meshStandardMaterial
          color={COLORS.wood}
          flatShading
          roughness={0.7}
        />
      </mesh>

      {/* Gold accent ring */}
      <mesh position={[0, -0.05, 0]} castShadow>
        <boxGeometry args={[0.055, 0.03, 0.055]} />
        <meshStandardMaterial
          color={COLORS.accent}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>

      {/* Magic tip - crystal */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[0.06, 0.1, 0.06]} />
        <meshStandardMaterial
          color={COLORS.tip}
          flatShading
          emissive={COLORS.glow}
          emissiveIntensity={0.4}
          roughness={0.3}
        />
      </mesh>

      {/* Glow effect (subtle) */}
      <mesh position={[0, 0.32, 0]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshBasicMaterial
          color={COLORS.glow}
          transparent
          opacity={0.3}
        />
      </mesh>
    </group>
  );
}

export default Wand;
