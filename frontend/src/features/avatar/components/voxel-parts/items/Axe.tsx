/**
 * Axe Item Component
 * Woodcutter's axe with wooden handle
 */

interface AxeProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  blade: '#607D8B',      // Steel gray blade
  handle: '#8B4513',     // Brown wooden handle
  grip: '#654321',       // Darker grip
};

export function Axe({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: AxeProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Axe blade - main part */}
      <mesh position={[0.06, 0.28, 0]} castShadow>
        <boxGeometry args={[0.15, 0.18, 0.03]} />
        <meshStandardMaterial
          color={COLORS.blade}
          flatShading
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>

      {/* Axe blade - edge (thinner) */}
      <mesh position={[0.14, 0.28, 0]} castShadow>
        <boxGeometry args={[0.03, 0.2, 0.02]} />
        <meshStandardMaterial
          color={COLORS.blade}
          flatShading
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>

      {/* Axe head mounting */}
      <mesh position={[-0.02, 0.28, 0]} castShadow>
        <boxGeometry args={[0.06, 0.1, 0.06]} />
        <meshStandardMaterial
          color={COLORS.blade}
          flatShading
          metalness={0.5}
          roughness={0.5}
        />
      </mesh>

      {/* Handle */}
      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[0.05, 0.38, 0.05]} />
        <meshStandardMaterial
          color={COLORS.handle}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Handle grip */}
      <mesh position={[0, -0.12, 0]} castShadow>
        <boxGeometry args={[0.055, 0.1, 0.055]} />
        <meshStandardMaterial
          color={COLORS.grip}
          flatShading
          roughness={0.7}
        />
      </mesh>
    </group>
  );
}

export default Axe;
