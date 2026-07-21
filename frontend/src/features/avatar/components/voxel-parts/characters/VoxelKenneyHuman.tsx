/**
 * VoxelKenneyHuman - Kenney style mini character
 * Pink shirt human with detailed features
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelKenneyHumanProps {
  animate?: boolean;
}

// Kenney human colors
const COLORS = {
  skin: '#FFD7C4',
  hair: '#3D2314',
  shirt: '#E91E63',      // Pink shirt
  pants: '#1A237E',      // Navy pants
  shoes: '#212121',      // Dark shoes
  eyes: '#FFFFFF',
  pupils: '#000000',
};

export function VoxelKenneyHuman({ animate = false }: VoxelKenneyHumanProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (animate && groupRef.current) {
      const time = state.clock.getElapsedTime();
      // Cheerful bouncing
      groupRef.current.position.y = Math.sin(time * 2.5) * 0.03;
      // Slight rotation
      groupRef.current.rotation.y = Math.sin(time * 1.5) * 0.08;
    }
  });

  return (
    <group ref={groupRef}>
      {/* === HEAD === */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.4, 0.4, 0.35]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* === HAIR === */}
      {/* Hair top */}
      <mesh position={[0, 0.98, -0.02]} castShadow>
        <boxGeometry args={[0.42, 0.12, 0.38]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.9} />
      </mesh>
      {/* Hair back */}
      <mesh position={[0, 0.88, -0.15]} castShadow>
        <boxGeometry args={[0.4, 0.2, 0.1]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.9} />
      </mesh>
      {/* Hair sides */}
      <mesh position={[-0.2, 0.85, 0]} castShadow>
        <boxGeometry args={[0.06, 0.15, 0.25]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0.2, 0.85, 0]} castShadow>
        <boxGeometry args={[0.06, 0.15, 0.25]} />
        <meshStandardMaterial color={COLORS.hair} flatShading roughness={0.9} />
      </mesh>

      {/* === EYES === */}
      <mesh position={[-0.1, 0.78, 0.18]}>
        <boxGeometry args={[0.08, 0.08, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      <mesh position={[0.1, 0.78, 0.18]}>
        <boxGeometry args={[0.08, 0.08, 0.02]} />
        <meshBasicMaterial color={COLORS.eyes} />
      </mesh>
      {/* Pupils */}
      <mesh position={[-0.1, 0.78, 0.19]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshBasicMaterial color={COLORS.pupils} />
      </mesh>
      <mesh position={[0.1, 0.78, 0.19]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshBasicMaterial color={COLORS.pupils} />
      </mesh>

      {/* === SMILE === */}
      <mesh position={[0, 0.65, 0.18]}>
        <boxGeometry args={[0.12, 0.03, 0.02]} />
        <meshBasicMaterial color={COLORS.pupils} />
      </mesh>

      {/* === EARS === */}
      <mesh position={[-0.22, 0.75, 0]} castShadow>
        <boxGeometry args={[0.06, 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.22, 0.75, 0]} castShadow>
        <boxGeometry args={[0.06, 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* === BODY/SHIRT === */}
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.45, 0.4, 0.3]} />
        <meshStandardMaterial color={COLORS.shirt} flatShading roughness={0.8} />
      </mesh>

      {/* === ARMS === */}
      <mesh position={[-0.3, 0.4, 0]} castShadow>
        <boxGeometry args={[0.12, 0.35, 0.12]} />
        <meshStandardMaterial color={COLORS.shirt} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.3, 0.4, 0]} castShadow>
        <boxGeometry args={[0.12, 0.35, 0.12]} />
        <meshStandardMaterial color={COLORS.shirt} flatShading roughness={0.8} />
      </mesh>

      {/* === HANDS === */}
      <mesh position={[-0.3, 0.18, 0]} castShadow>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.3, 0.18, 0]} castShadow>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={COLORS.skin} flatShading roughness={0.8} />
      </mesh>

      {/* === PANTS === */}
      <mesh position={[0, 0.12, 0]} castShadow>
        <boxGeometry args={[0.4, 0.15, 0.28]} />
        <meshStandardMaterial color={COLORS.pants} flatShading roughness={0.8} />
      </mesh>

      {/* === LEGS === */}
      <mesh position={[-0.1, -0.02, 0]} castShadow>
        <boxGeometry args={[0.14, 0.18, 0.14]} />
        <meshStandardMaterial color={COLORS.pants} flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.1, -0.02, 0]} castShadow>
        <boxGeometry args={[0.14, 0.18, 0.14]} />
        <meshStandardMaterial color={COLORS.pants} flatShading roughness={0.8} />
      </mesh>

      {/* === SHOES === */}
      <mesh position={[-0.1, -0.13, 0.02]} castShadow>
        <boxGeometry args={[0.15, 0.06, 0.18]} />
        <meshStandardMaterial color={COLORS.shoes} flatShading />
      </mesh>
      <mesh position={[0.1, -0.13, 0.02]} castShadow>
        <boxGeometry args={[0.15, 0.06, 0.18]} />
        <meshStandardMaterial color={COLORS.shoes} flatShading />
      </mesh>

      {/* Ground shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
        <circleGeometry args={[0.35, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export default VoxelKenneyHuman;
