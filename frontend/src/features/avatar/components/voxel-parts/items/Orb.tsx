/**
 * Orb Item Component
 * Magical floating orb with glow effect
 */

interface OrbProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  orb: '#9333EA',
  orbLight: '#A855F7',
  glow: '#9333EA',
};

export function Orb({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: OrbProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Main orb - using box for voxel style */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.12, 0.12, 0.12]} />
        <meshStandardMaterial
          color={COLORS.orb}
          flatShading
          emissive={COLORS.orb}
          emissiveIntensity={0.5}
          metalness={0.3}
          roughness={0.2}
        />
      </mesh>

      {/* Inner glow layer */}
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshBasicMaterial
          color={COLORS.orbLight}
          transparent
          opacity={0.6}
        />
      </mesh>

      {/* Outer glow effect */}
      <mesh position={[0, 0.08, 0]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial
          color={COLORS.glow}
          transparent
          opacity={0.25}
        />
      </mesh>

      {/* Energy sparkle points */}
      <mesh position={[0.05, 0.13, 0.05]}>
        <boxGeometry args={[0.02, 0.02, 0.02]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      <mesh position={[-0.04, 0.06, -0.04]}>
        <boxGeometry args={[0.015, 0.015, 0.015]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
    </group>
  );
}

export default Orb;
