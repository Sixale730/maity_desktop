/**
 * Crystal Item Component
 * Magical glowing crystal
 */

interface CrystalProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  crystal: '#06B6D4',
  crystalLight: '#22D3EE',
  glow: '#06B6D4',
};

export function Crystal({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: CrystalProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Main crystal body - hexagonal approximation with boxes */}
      <mesh position={[0, 0.05, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <boxGeometry args={[0.08, 0.18, 0.08]} />
        <meshStandardMaterial
          color={COLORS.crystal}
          flatShading
          emissive={COLORS.crystal}
          emissiveIntensity={0.5}
          metalness={0.2}
          roughness={0.2}
        />
      </mesh>

      {/* Crystal top point */}
      <mesh position={[0, 0.16, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <boxGeometry args={[0.05, 0.08, 0.05]} />
        <meshStandardMaterial
          color={COLORS.crystalLight}
          flatShading
          emissive={COLORS.crystalLight}
          emissiveIntensity={0.6}
          metalness={0.2}
          roughness={0.2}
        />
      </mesh>

      {/* Crystal base */}
      <mesh position={[0, -0.06, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <boxGeometry args={[0.06, 0.04, 0.06]} />
        <meshStandardMaterial
          color={COLORS.crystal}
          flatShading
          emissive={COLORS.crystal}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Glow effect */}
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial
          color={COLORS.glow}
          transparent
          opacity={0.2}
        />
      </mesh>

      {/* Light sparkles */}
      <mesh position={[0.03, 0.12, 0.03]}>
        <boxGeometry args={[0.015, 0.015, 0.015]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      <mesh position={[-0.025, 0.0, -0.025]}>
        <boxGeometry args={[0.012, 0.012, 0.012]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
    </group>
  );
}

export default Crystal;
