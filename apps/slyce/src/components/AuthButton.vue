<template>
  <div class="auth-button">
    <button
      v-if="!isAuthenticated"
      @click="openBetaModal"
      class="btn-login"
    >
      <span class="material-symbols-outlined">login</span>
      <span class="login-text">Login</span>
    </button>

    <template v-else>
      <!-- User info - stays in header row -->
      <div class="user-info">
        <img
          v-if="user?.picture"
          :src="user.picture"
          :alt="user.name"
          class="avatar"
        />
        <span
          v-else
          class="material-symbols-outlined avatar-placeholder"
        >account_circle</span>
        <span class="username">{{ user?.name || user?.email }}</span>
      </div>

      <!-- Navigation menu - separate on mobile -->
      <nav class="nav-menu">
        <router-link
          to="/"
          class="nav-link"
          :class="$route.path === '/' ? 'nav-link-active' : ''"
        >
          Create
        </router-link>
        <router-link
          to="/my-textures"
          class="nav-link"
          :class="$route.path === '/my-textures' ? 'nav-link-active' : ''"
        >
          Textures
        </router-link>
        <button
          @click="logout"
          class="btn-logout"
        >
          <span class="material-symbols-outlined">logout</span>
          <span class="logout-text">Logout</span>
        </button>
      </nav>
    </template>

    <!-- Beta Access Modal -->
    <BetaModal ref="betaModalRef" />
  </div>
</template>

<script setup>
  import { ref } from 'vue'
  import { useGoogleAuth } from '../composables/useGoogleAuth'
  import { useRoute } from 'vue-router'
  import BetaModal from './BetaModal.vue'

  const { user, isAuthenticated, logout } = useGoogleAuth()
  const $route = useRoute()

  const betaModalRef = ref(null)

  function openBetaModal() {
    betaModalRef.value?.open()
  }
</script>

<style scoped>
  .auth-button {
    display: contents;
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .nav-menu {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    justify-content: flex-start;
  }

  @media (min-width: 640px) {
    .nav-menu {
      width: auto;
      justify-content: flex-end;
    }
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
  }

  @media (min-width: 640px) {
    .avatar {
      width: 32px;
      height: 32px;
    }
  }

  .avatar-placeholder {
    font-size: 28px;
    color: #6b7280;
  }

  @media (min-width: 640px) {
    .avatar-placeholder {
      font-size: 32px;
    }
  }

  .username {
    font-size: 0.8rem;
    color: #333;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (min-width: 640px) {
    .username {
      font-size: 0.9rem;
      max-width: 150px;
    }
  }

  .btn-login,
  .btn-logout {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.4rem 0.6rem;
    border: none;
    border-radius: 0;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    transition: all 0.2s;
  }

  @media (min-width: 640px) {

    .btn-login,
    .btn-logout {
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      font-size: 0.9rem;
    }
  }

  .btn-login {
    background-color: #4a4a4a;
    color: white;
  }

  .btn-login:hover {
    background-color: #1a1a1a;
  }

  .btn-logout {
    background-color: #f0f0f0;
    color: #333;
  }

  .btn-logout:hover {
    background-color: #e0e0e0;
  }

  .btn-login .material-symbols-outlined,
  .btn-logout .material-symbols-outlined {
    font-size: 16px;
  }

  @media (min-width: 640px) {

    .btn-login .material-symbols-outlined,
    .btn-logout .material-symbols-outlined {
      font-size: 18px;
    }
  }

  .login-text,
  .logout-text {
    display: none;
  }

  @media (min-width: 480px) {

    .login-text,
    .logout-text {
      display: inline;
    }
  }

  .nav-link {
    display: flex;
    align-items: center;
    padding: 0.4rem 0.6rem;
    border-radius: 0;
    font-size: 0.8rem;
    font-weight: 500;
    background-color: #f0f0f0;
    color: #333;
    text-decoration: none;
    transition: background-color 0.2s;
  }

  @media (min-width: 640px) {
    .nav-link {
      padding: 0.5rem 1rem;
      font-size: 0.9rem;
    }
  }

  .nav-link:hover {
    background-color: #e0e0e0;
  }

  .nav-link-active {
    background-color: #4a4a4a;
    color: white;
  }

  .nav-link-active:hover {
    background-color: #1a1a1a;
  }
</style>
