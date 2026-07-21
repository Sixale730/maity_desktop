/**
 * Potion Item Component
 * Classic potion bottle with liquid
 */

interface PotionProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  glass: '#E5E5E5',
  glassDark: '#D4D4D4',
  liquid: '#22C55E',
  liquidLight: '#4ADE80',
  cork: '#D2691E',
  corkDark: '#A0522D',
};

export function Potion({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: PotionProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Bottle body */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.1, 0.14, 0.1]} />
        <meshStandardMaterial
          color={COLORS.glass}
          flatShading
          transparent
          opacity={0.7}
          roughness={0.2}
        />
      </mesh>

      {/* Liquid inside */}
      <mesh position={[0, -0.01, 0]}>
        <boxGeometry args={[0.085, 0.1, 0.085]} />
        <meshStandardMaterial
          color={COLORS.liquid}
          flatShading
          emissive={COLORS.liquid}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Liquid bubble */}
      <mesh position={[0.02, 0.02, 0.02]}>
        <boxGeometry args={[0.02, 0.02, 0.02]} />
        <meshBasicMaterial color={COLORS.liquidLight} />
      </mesh>

      {/* Bottle neck */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.05, 0.06, 0.05]} />
        <meshStandardMaterial
          color={COLORS.glassDark}
          flatShading
          transparent
          opacity={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* Cork */}
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.045, 0.05, 0.045]} />
        <meshStandardMaterial color={COLORS.cork} flatShading roughness={0.9} />
      </mesh>

      {/* Cork top */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.055, 0.025, 0.055]} />
        <meshStandardMaterial color={COLORS.corkDark} flatShading roughness={0.9} />
      </mesh>
    </group>
  );
}

export default Potion;
