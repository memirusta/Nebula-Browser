import { motion } from 'framer-motion'
import styles from './AmbientBackground.module.css'

export function AmbientBackground() {
  return (
    <div className={styles.root} aria-hidden="true">
      <motion.div
        className={styles.orb1}
        animate={{
          x: [0, 60, -30, 0],
          y: [0, -40, 20, 0],
          scale: [1, 1.1, 0.95, 1],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className={styles.orb2}
        animate={{
          x: [0, -50, 40, 0],
          y: [0, 30, -50, 0],
          scale: [1, 0.9, 1.15, 1],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className={styles.orb3}
        animate={{
          x: [0, 30, -60, 0],
          y: [0, 50, -20, 0],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className={styles.noise} />
      <div className={styles.vignette} />
    </div>
  )
}
