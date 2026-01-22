<script setup>

    import { useAppStore } from '../stores/appStore';
    const app = useAppStore()  // Pinia store

    import { onMounted, computed } from 'vue';
    import { dragAndDrop } from '../modules/dragAndDropHandler';

    import Header from '../components/Header.vue'
    import Footer from '../components/Footer.vue'
    import UploadArea from '../components/UploadArea.vue';
    import SettingsArea from '../components/SettingsArea.vue';
    import ResultsArea from '../components/ResultsArea.vue';


    import Tabs from 'primevue/tabs';
    import TabList from 'primevue/tablist';
    import Tab from 'primevue/tab';
    import TabPanels from 'primevue/tabpanels';
    import TabPanel from 'primevue/tabpanel';

    // Check if processing is in progress
    const isProcessing = computed(() => Object.keys(app.status).length > 0);

    // Handle tab changes - confirm if leaving Results during processing
    function handleTabChange(newTab) {
        // If switching away from Results tab while processing
        if (app.currentTab === '2' && newTab !== '2' && isProcessing.value) {
            const confirmed = confirm(
                'Processing is in progress. Switching tabs will abandon the current process and clear any generated results. Continue?'
            );
            if (!confirmed) {
                return; // Don't change tab
            }
            // Clear processing results but keep video and settings
            app.resetProcessing();
        }
        app.currentTab = newTab;
    }

    onMounted(() => {
        dragAndDrop((file) => {
            app.set('file', file)
            app.set('fileURL', URL.createObjectURL(file))
            app.set('currentTab', '1')
        });
    });

</script>

<template>
    <main>

        <Header></Header>

        <Tabs :value="app.currentTab">
            <TabList>
                <Tab
                    value="0"
                    @click="handleTabChange('0')"
                >Start</Tab>
                <Tab
                    value="1"
                    @click="handleTabChange('1')"
                >Settings</Tab>
                <Tab
                    value="2"
                    @click="handleTabChange('2')"
                >Results</Tab>
            </TabList>
            <TabPanels>
                <TabPanel value="0">
                    <UploadArea></UploadArea>
                </TabPanel>
                <TabPanel value="1">
                    <SettingsArea></SettingsArea>
                </TabPanel>
                <TabPanel value="2">
                    <ResultsArea />
                </TabPanel>
            </TabPanels>
        </Tabs>
        <Footer></Footer>


    </main>


</template>

<style>
    main {
        font-family: Avenir, Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-align: center;
        color: #2c3e50;
        min-height: 100vh;
    }
</style>
