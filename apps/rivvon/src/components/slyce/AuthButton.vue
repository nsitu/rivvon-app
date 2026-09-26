<template>
  <div class="auth-button">
    <Button
      v-if="!isAuthenticated"
      type="button"
      @click="openBetaModal"
      severity="secondary"
      text
      class="auth-action-button login-action rivvon-workflow-button--compact"
    >
      <span class="material-symbols-outlined">login</span>
      <span class="login-text">Login</span>
    </Button>

    <template v-else>
      <!-- User info - stays in header row -->
      <div class="user-info">
        <img
          v-if="user?.picture"
          :src="user.picture"
          :alt="user.name"
          class="avatar"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"
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
          to="/create"
          class="nav-link"
          :class="$route.path === '/create' ? 'nav-link-active' : ''"
        >
          Create
        </router-link>
        <Button
          type="button"
          @click="logout"
          severity="secondary"
          text
          class="auth-action-button logout-action rivvon-workflow-button--compact"
        >
          <span class="material-symbols-outlined">logout</span>
          <span class="logout-text">Logout</span>
        </Button>
      </nav>
    </template>

    <!-- Beta Access Modal -->
    <BetaModal ref="betaModalRef" />
  </div>
</template>

<script setup>
  import { ref } from 'vue'
  import Button from 'primevue/button'
  import { useGoogleAuth } from '../../composables/shared/useGoogleAuth'
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
    color: var(--text-muted);
  }

  @media (min-width: 640px) {
    .avatar-placeholder {
      font-size: 32px;
    }
  }

  .username {
    font-size: 0.8rem;
    color: var(--text-primary);
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

  .auth-action-button {
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

    .auth-action-button {
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      font-size: 0.9rem;
    }
  }

  .login-action {
    background-color: #4a4a4a;
    color: white;
  }

  .login-action:hover {
    background-color: #1a1a1a;
  }

  .logout-action {
    background-color: var(--bg-muted);
    color: var(--text-primary);
  }

  .logout-action:hover {
    background-color: var(--bg-muted-alt);
  }

  .auth-action-button .material-symbols-outlined {
    font-size: 16px;
  }

  @media (min-width: 640px) {

    .auth-action-button .material-symbols-outlined {
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
    background-color: var(--bg-muted);
    color: var(--text-primary);
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
    background-color: var(--bg-muted-alt);
  }

  .nav-link-active {
    background-color: #4a4a4a;
    color: white;
  }

  .nav-link-active:hover {
    background-color: #1a1a1a;
  }

  .nav-button {
    border: none;
    cursor: pointer;
  }
</style>
