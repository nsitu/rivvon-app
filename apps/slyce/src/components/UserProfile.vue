<template>
  <div
    v-if="isAuthenticated"
    class="user-profile"
  >
    <div class="profile-header">
      <img
        v-if="user?.picture"
        :src="user.picture"
        :alt="user.name"
        class="profile-avatar"
        referrerpolicy="no-referrer"
      />
      <span
        v-else
        class="material-symbols-outlined profile-avatar-placeholder"
      >account_circle</span>
      <div class="profile-info">
        <h3>{{ user?.name }}</h3>
        <p class="email">{{ user?.email }}</p>
        <span class="status-badge">✓ Authenticated</span>
      </div>
    </div>
    <div class="profile-meta">
      <p class="text-sm">Ready to upload textures to Rivvon CDN</p>
    </div>
  </div>
</template>

<script setup>
  import { useAuth0 } from '@auth0/auth0-vue'

  const { user, isAuthenticated } = useAuth0()
</script>

<style scoped>
  .user-profile {
    padding: 1.5rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 8px;
    margin-bottom: 2rem;
    color: white;
    text-align: left;
  }

  .profile-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .profile-avatar {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    object-fit: cover;
  }

  .profile-avatar-placeholder {
    font-size: 64px;
    color: rgba(255, 255, 255, 0.8);
  }

  .profile-info h3 {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 600;
  }

  .email {
    color: rgba(255, 255, 255, 0.9);
    margin: 0.25rem 0;
    font-size: 0.9rem;
  }

  .status-badge {
    background: rgba(255, 255, 255, 0.2);
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 500;
    display: inline-block;
    margin-top: 0.5rem;
  }

  .profile-meta {
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    padding-top: 0.75rem;
  }

  .text-sm {
    font-size: 0.85rem;
    margin: 0;
    opacity: 0.9;
  }

  @media (max-width: 640px) {
    .user-profile {
      padding: 1rem;
    }

    .profile-avatar {
      width: 48px;
      height: 48px;
    }

    .profile-avatar-placeholder {
      font-size: 48px;
    }
  }
</style>
