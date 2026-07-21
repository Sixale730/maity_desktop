/**
 * Spatula Item Component
 * Kitchen spatula for cooking
 */

interface SpatulaProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  head: '#C0C0C0',       // Stainless steel head
  handle: '#1F2937',     // Dark gray/black handle
  grip: '#374151',       // Slightly lighter grip
};

export function Spatula({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: SpatulaProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Spatula head (flat part) */}
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[0.12, 0.18, 0.02]} />
        <meshStandardMaterial
          color={COLORS.head}
          flatShading
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>

      {/* Spatula neck (connects head to handle) */}
      <mesh position={[0, 0.14, 0]} castShadow>
        <boxGeometry args={[0.04, 0.1, 0.02]} />
        <meshStandardMaterial
          color={COLORS.head}
          flatShading
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>

      {/* Handle */}
      <mesh position={[0, -0.02, 0]} castShadow>
        <boxGeometry args={[0.04, 0.22, 0.04]} />
        <meshStandardMaterial
          color={COLORS.handle}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Handle grip */}
      <mesh position={[0, -0.1, 0]} castShadow>
        <boxGeometry args={[0.045, 0.1, 0.045]} />
        <meshStandardMaterial
          color={COLORS.grip}
          flatShading
          roughness={0.7}
        />
      </mesh>

      {/* Handle end */}
      <mesh position={[0, -0.16, 0]} castShadow>
        <boxGeometry args={[0.05, 0.03, 0.05]} />
        <meshStandardMaterial
          color={COLORS.handle}
          flatShading
          roughness={0.8}
        />
      </mesh>
    </group>
  );
}

export default Spatula;
