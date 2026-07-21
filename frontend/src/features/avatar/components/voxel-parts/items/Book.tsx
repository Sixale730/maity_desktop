/**
 * Book Item Component
 * Knowledge book with leather cover
 */

interface BookProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  cover: '#8B0000',      // Dark red leather cover
  spine: '#5C0000',      // Darker spine
  pages: '#FFFFF0',      // Ivory pages
  accent: '#FFD700',     // Gold accents
};

export function Book({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: BookProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Book cover - front */}
      <mesh position={[0.04, 0, 0]} castShadow>
        <boxGeometry args={[0.02, 0.25, 0.18]} />
        <meshStandardMaterial
          color={COLORS.cover}
          flatShading
          roughness={0.7}
        />
      </mesh>

      {/* Book cover - back */}
      <mesh position={[-0.04, 0, 0]} castShadow>
        <boxGeometry args={[0.02, 0.25, 0.18]} />
        <meshStandardMaterial
          color={COLORS.cover}
          flatShading
          roughness={0.7}
        />
      </mesh>

      {/* Book spine */}
      <mesh position={[0, 0, -0.09]} castShadow>
        <boxGeometry args={[0.1, 0.25, 0.02]} />
        <meshStandardMaterial
          color={COLORS.spine}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Book pages */}
      <mesh position={[0, 0, 0.02]} castShadow>
        <boxGeometry args={[0.06, 0.23, 0.14]} />
        <meshStandardMaterial
          color={COLORS.pages}
          flatShading
          roughness={0.9}
        />
      </mesh>

      {/* Gold corner accent - top */}
      <mesh position={[0.04, 0.11, 0.07]} castShadow>
        <boxGeometry args={[0.025, 0.04, 0.04]} />
        <meshStandardMaterial
          color={COLORS.accent}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>

      {/* Gold corner accent - bottom */}
      <mesh position={[0.04, -0.11, 0.07]} castShadow>
        <boxGeometry args={[0.025, 0.04, 0.04]} />
        <meshStandardMaterial
          color={COLORS.accent}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>

      {/* Spine decoration */}
      <mesh position={[0, 0, -0.1]} castShadow>
        <boxGeometry args={[0.06, 0.04, 0.02]} />
        <meshStandardMaterial
          color={COLORS.accent}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}

export default Book;
