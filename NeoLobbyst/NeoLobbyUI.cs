using System;
using System.Collections.Generic;
using MelonLoader;
using Steamworks;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using UnityEngine.EventSystems;
using System.Threading.Tasks;
using ReluNetwork.ConstEnum;

namespace NeoLobbyst
{
    public class NeoLobbyUI : MonoBehaviour
    {
        private static NeoLobbyUI _instance;
        private bool _visible = false;

        private GameObject _mainPanel;
        private GameObject _contentContainer;
        private List<GameObject> _lobbyItems = new List<GameObject>();
        private List<OpenGameInfo> _lobbies = new List<OpenGameInfo>();

        private TMP_Text _statusText;
        private bool _isRefreshing = false;

        private CallResult<LobbyMatchList_t> _lobbyMatchList;

        public static void Show()
        {
            EnsureCreated();
            _instance._visible = true;
            _instance._mainPanel?.SetActive(true);
            _instance.RefreshLobbies();
        }

        public static void Hide()
        {
            if (_instance != null)
            {
                _instance._visible = false;
                _instance._mainPanel?.SetActive(false);
            }
        }

        private static void EnsureCreated()
        {
            if (_instance != null) return;

            GameObject go = new GameObject("NeoLobbyUI");
            UnityEngine.Object.DontDestroyOnLoad(go);
            _instance = go.AddComponent<NeoLobbyUI>();
        }

        private void Awake()
        {
            _lobbyMatchList = CallResult<LobbyMatchList_t>.Create(OnLobbyMatchListReceived);
            CreateUI();
        }

        private void CreateUI()
        {
            try
            {
                Canvas mainCanvas = null;
                Canvas[] canvases = FindObjectsOfType<Canvas>();
                foreach (Canvas c in canvases)
                {
                    if (c.transform.parent == null)
                    {
                        mainCanvas = c;
                        break;
                    }
                }
                if (mainCanvas == null && canvases.Length > 0)
                    mainCanvas = canvases[canvases.Length - 1];

                if (mainCanvas == null)
                {
                    MelonLogger.Error("[NeoLobbyUI] No Canvas found!");
                    return;
                }

                _mainPanel = new GameObject("NeoLobbyPanel");
                _mainPanel.transform.SetParent(mainCanvas.transform, false);
                _mainPanel.transform.SetAsLastSibling();

                RectTransform panelRect = _mainPanel.AddComponent<RectTransform>();
                panelRect.anchorMin = Vector2.zero;
                panelRect.anchorMax = Vector2.one;
                panelRect.offsetMin = Vector2.zero;
                panelRect.offsetMax = Vector2.zero;

                Image panelImage = _mainPanel.AddComponent<Image>();
                panelImage.color = new Color(0.08f, 0.08f, 0.1f, 0.98f);

                CanvasGroup cg = _mainPanel.AddComponent<CanvasGroup>();
                cg.alpha = 1f;
                cg.interactable = true;
                cg.blocksRaycasts = true;

                GraphicRaycaster raycaster = _mainPanel.AddComponent<GraphicRaycaster>();

                GameObject container = new GameObject("Container");
                container.transform.SetParent(_mainPanel.transform, false);
                RectTransform containerRect = container.AddComponent<RectTransform>();
                containerRect.anchorMin = new Vector2(0.5f, 0.5f);
                containerRect.anchorMax = new Vector2(0.5f, 0.5f);
                containerRect.pivot = new Vector2(0.5f, 0.5f);
                containerRect.anchoredPosition = Vector2.zero;
                containerRect.sizeDelta = new Vector2(900, 700);

                Image containerImage = container.AddComponent<Image>();
                containerImage.color = new Color(0.1f, 0.1f, 0.12f, 0.95f);

                Outline outline = container.AddComponent<Outline>();
                outline.effectColor = new Color(1, 1, 1, 0.1f);
                outline.effectDistance = new Vector2(1, -1);

                GameObject titleObj = new GameObject("Title");
                titleObj.transform.SetParent(container.transform, false);
                RectTransform titleRect = titleObj.AddComponent<RectTransform>();
                titleRect.anchorMin = new Vector2(0.5f, 1f);
                titleRect.anchorMax = new Vector2(0.5f, 1f);
                titleRect.pivot = new Vector2(0.5f, 1f);
                titleRect.anchoredPosition = new Vector2(0, -15);
                titleRect.sizeDelta = new Vector2(400, 50);

                TMP_Text titleText = titleObj.AddComponent<TextMeshProUGUI>();
                titleText.text = "LOBBY BROWSER";
                titleText.fontSize = 36;
                titleText.fontStyle = FontStyles.Bold;
                titleText.alignment = TextAlignmentOptions.Center;
                titleText.color = Color.white;

                GameObject closeBtn = CreateButton(container, "X", new Vector2(50, 50));
                RectTransform closeRect = closeBtn.GetComponent<RectTransform>();
                closeRect.anchorMin = new Vector2(1, 1);
                closeRect.anchorMax = new Vector2(1, 1);
                closeRect.pivot = new Vector2(1, 1);
                closeRect.anchoredPosition = new Vector2(-10, -10);
                closeBtn.GetComponent<Button>().onClick.AddListener(() => Hide());

                GameObject statusObj = new GameObject("Status");
                statusObj.transform.SetParent(container.transform, false);
                RectTransform statusRect = statusObj.AddComponent<RectTransform>();
                statusRect.anchorMin = new Vector2(0.5f, 1);
                statusRect.anchorMax = new Vector2(0.5f, 1);
                statusRect.pivot = new Vector2(0.5f, 1);
                statusRect.anchoredPosition = new Vector2(0, -65);
                statusRect.sizeDelta = new Vector2(800, 30);

                _statusText = statusObj.AddComponent<TextMeshProUGUI>();
                _statusText.text = "Click REFRESH to find lobbies";
                _statusText.fontSize = 18;
                _statusText.alignment = TextAlignmentOptions.Center;
                _statusText.color = new Color(0.7f, 0.7f, 0.7f, 1);

                GameObject refreshBtn = CreateButton(container, "REFRESH", new Vector2(120, 40));
                Image refreshImg = refreshBtn.GetComponent<Image>();
                refreshImg.color = new Color(0.2f, 0.45f, 0.7f, 1);
                RectTransform refreshRect = refreshBtn.GetComponent<RectTransform>();
                refreshRect.anchorMin = new Vector2(0, 0);
                refreshRect.anchorMax = new Vector2(0, 0);
                refreshRect.pivot = new Vector2(0, 0);
                refreshRect.anchoredPosition = new Vector2(20, 25);
                refreshBtn.GetComponent<Button>().onClick.AddListener(() => RefreshLobbies());

                GameObject loadBtn = CreateButton(container, "LOAD GAME", new Vector2(140, 40));
                Image loadImg = loadBtn.GetComponent<Image>();
                loadImg.color = new Color(0.5f, 0.35f, 0.7f, 1);
                RectTransform loadRect = loadBtn.GetComponent<RectTransform>();
                loadRect.anchorMin = new Vector2(0.5f, 0);
                loadRect.anchorMax = new Vector2(0.5f, 0);
                loadRect.pivot = new Vector2(0.5f, 0);
                loadRect.anchoredPosition = new Vector2(-5, 25);
                loadBtn.GetComponent<Button>().onClick.AddListener(() => LoadGame());

                GameObject createBtn = CreateButton(container, "CREATE ROOM", new Vector2(140, 40));
                Image createImg = createBtn.GetComponent<Image>();
                createImg.color = new Color(0.2f, 0.6f, 0.35f, 1);
                RectTransform createRect = createBtn.GetComponent<RectTransform>();
                createRect.anchorMin = new Vector2(1, 0);
                createRect.anchorMax = new Vector2(1, 0);
                createRect.pivot = new Vector2(1, 0);
                createRect.anchoredPosition = new Vector2(-20, 25);
                createBtn.GetComponent<Button>().onClick.AddListener(() => CreateRoom());

                GameObject scrollObj = new GameObject("ScrollView");
                scrollObj.transform.SetParent(container.transform, false);
                RectTransform scrollRect = scrollObj.AddComponent<RectTransform>();
                scrollRect.anchorMin = new Vector2(0, 0);
                scrollRect.anchorMax = new Vector2(1, 1);
                scrollRect.offsetMin = new Vector2(20, 100);
                scrollRect.offsetMax = new Vector2(-20, -80);

                ScrollRect scroll = scrollObj.AddComponent<ScrollRect>();
                scroll.horizontal = false;
                scroll.vertical = true;
                scroll.movementType = ScrollRect.MovementType.Clamped;

                Image scrollBg = scrollObj.AddComponent<Image>();
                scrollBg.color = new Color(0.06f, 0.06f, 0.08f, 0.9f);

                GameObject viewport = new GameObject("Viewport");
                viewport.transform.SetParent(scrollObj.transform, false);
                RectTransform viewportRect = viewport.AddComponent<RectTransform>();
                viewportRect.anchorMin = Vector2.zero;
                viewportRect.anchorMax = Vector2.one;
                viewportRect.offsetMin = Vector2.zero;
                viewportRect.offsetMax = Vector2.zero;

                Image viewportImg = viewport.AddComponent<Image>();
                viewportImg.color = new Color(0.06f, 0.06f, 0.08f, 1);

                Mask mask = viewport.AddComponent<Mask>();
                mask.showMaskGraphic = true;

                _contentContainer = new GameObject("Content");
                _contentContainer.transform.SetParent(viewport.transform, false);
                RectTransform contentRect = _contentContainer.AddComponent<RectTransform>();
                contentRect.anchorMin = new Vector2(0, 1);
                contentRect.anchorMax = new Vector2(1, 1);
                contentRect.pivot = new Vector2(0.5f, 1);
                contentRect.anchoredPosition = Vector2.zero;
                contentRect.sizeDelta = new Vector2(0, 0);

                VerticalLayoutGroup layout = _contentContainer.AddComponent<VerticalLayoutGroup>();
                layout.spacing = 8;
                layout.padding = new RectOffset(8, 8, 8, 8);
                layout.childAlignment = TextAnchor.UpperCenter;
                layout.childControlWidth = true;
                layout.childControlHeight = false;
                layout.childForceExpandWidth = true;
                layout.childForceExpandHeight = false;

                ContentSizeFitter fitter = _contentContainer.AddComponent<ContentSizeFitter>();
                fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
                fitter.horizontalFit = ContentSizeFitter.FitMode.Unconstrained;

                scroll.content = contentRect;
                scroll.viewport = viewportRect;

                _mainPanel.SetActive(false);

                MelonLogger.Msg("[NeoLobbyUI] UI created successfully");
            }
            catch (Exception ex)
            {
                MelonLogger.Error("[NeoLobbyUI] CreateUI failed: " + ex.Message);
                MelonLogger.Error("[NeoLobbyUI] Stack: " + ex.StackTrace);
            }
        }

        private GameObject CreateButton(GameObject parent, string text, Vector2 size)
        {
            GameObject btnObj = new GameObject("Button_" + text);
            btnObj.transform.SetParent(parent.transform, false);

            RectTransform btnRect = btnObj.AddComponent<RectTransform>();
            btnRect.sizeDelta = size;

            Image btnImage = btnObj.AddComponent<Image>();
            btnImage.color = new Color(0.25f, 0.25f, 0.28f, 1);
            btnImage.raycastTarget = true;

            Button btn = btnObj.AddComponent<Button>();
            btn.targetGraphic = btnImage;

            GameObject textObj = new GameObject("Text");
            textObj.transform.SetParent(btnObj.transform, false);
            RectTransform textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = Vector2.zero;
            textRect.offsetMax = Vector2.zero;

            TMP_Text btnText = textObj.AddComponent<TextMeshProUGUI>();
            btnText.text = text;
            btnText.fontSize = 20;
            btnText.alignment = TextAlignmentOptions.Center;
            btnText.color = Color.white;

            return btnObj;
        }

        private void RefreshLobbies()
        {
            if (_isRefreshing) return;
            _isRefreshing = true;
            _lobbies.Clear();
            ClearLobbyItems();

            if (_statusText != null)
                _statusText.text = "Searching for lobbies...";

            FetchRegistryLobbies();
            FetchSteamLobbies();
        }

        private async void FetchRegistryLobbies()
        {
            try
            {
                IReadOnlyList<OpenGameInfo> list = await LobbyAPI.GetLobbiesAsync();
                foreach (var lobby in list)
                {
                    if (!LobbyExists(lobby.LobbyId))
                    {
                        lobby.Source = "neolobbyst";
                        _lobbies.Add(lobby);
                    }
                }
            }
            catch (Exception ex)
            {
                MelonLogger.Error("[NeoLobbyUI] Registry fetch failed: " + ex.Message);
            }
        }

        private void FetchSteamLobbies()
        {
            try
            {
                SteamMatchmaking.AddRequestLobbyListFilterSlotsAvailable(1);
                SteamMatchmaking.AddRequestLobbyListDistanceFilter(ELobbyDistanceFilter.k_ELobbyDistanceFilterClose);
                SteamAPICall_t call = SteamMatchmaking.RequestLobbyList();
                _lobbyMatchList.Set(call, OnLobbyMatchListReceived);
            }
            catch (Exception ex)
            {
                MelonLogger.Error("[NeoLobbyUI] Steam fetch failed: " + ex.Message);
                _isRefreshing = false;
            }
        }

        private void OnLobbyMatchListReceived(LobbyMatchList_t result, bool ioFailure)
        {
            _isRefreshing = false;
            if (ioFailure) { _statusText.text = "Search failed"; return; }

            for (int i = 0; i < result.m_nLobbiesMatching; i++)
            {
                CSteamID id = SteamMatchmaking.GetLobbyByIndex(i);
                string sid = id.ToString();
                if (LobbyExists(sid)) continue;

                int count = SteamMatchmaking.GetNumLobbyMembers(id);
                string name = SteamMatchmaking.GetLobbyData(id, "LobbyName");
                string host = SteamFriends.GetFriendPersonaName(SteamMatchmaking.GetLobbyOwner(id));
                string region = SteamMatchmaking.GetLobbyData(id, "Locale");

                _lobbies.Add(new OpenGameInfo
                {
                    LobbyId = sid,
                    LobbyName = string.IsNullOrEmpty(name) ? "Lobby " + sid : name,
                    HostName = string.IsNullOrEmpty(host) ? "Host" : host,
                    Region = region ?? "",
                    PlayerCount = count,
                    MaxPlayers = 4,
                    Source = "steam"
                });
            }

            _statusText.text = $"Found {_lobbies.Count} lobbies";
            SortLobbiesBySource();
            RefreshUI();
        }

        private void SortLobbiesBySource()
        {
            _lobbies.Sort((a, b) =>
            {
                if (a.Source == "neolobbyst" && b.Source != "neolobbyst") return -1;
                if (a.Source != "neolobbyst" && b.Source == "neolobbyst") return 1;
                return 0;
            });
        }

        private bool LobbyExists(string lobbyId)
        {
            foreach (var lobby in _lobbies)
                if (lobby.LobbyId == lobbyId) return true;
            return false;
        }

        private void ClearLobbyItems()
        {
            foreach (var item in _lobbyItems)
                if (item != null) Destroy(item);
            _lobbyItems.Clear();
        }

        private void RefreshUI()
        {
            ClearLobbyItems();

            if (_lobbies.Count == 0)
            {
                if (_statusText != null)
                    _statusText.text = "No lobbies found";
                return;
            }

            foreach (var lobby in _lobbies)
                CreateLobbyItem(lobby);
        }

        private void CreateLobbyItem(OpenGameInfo lobby)
        {
            if (_contentContainer == null) return;

            GameObject card = new GameObject("LobbyItem_" + lobby.LobbyId);
            card.transform.SetParent(_contentContainer.transform, false);

            LayoutElement layout = card.AddComponent<LayoutElement>();
            layout.preferredHeight = 80;

            Image bg = card.AddComponent<Image>();
            bool isNeo = lobby.Source == "neolobbyst";
            bg.color = isNeo ? new Color(0.12f, 0.25f, 0.15f, 0.95f) : new Color(0.18f, 0.18f, 0.22f, 0.95f);

            Outline outline = card.AddComponent<Outline>();
            outline.effectColor = isNeo ? new Color(0.3f, 0.8f, 0.4f, 0.4f) : new Color(0.4f, 0.4f, 0.5f, 0.2f);
            outline.effectDistance = new Vector2(2, -2);

            Button btn = card.AddComponent<Button>();
            btn.targetGraphic = bg;
            btn.onClick.AddListener(() => TryJoinLobby(lobby));

            GameObject nameObj = new GameObject("Name");
            nameObj.transform.SetParent(card.transform, false);
            RectTransform nameRect = nameObj.AddComponent<RectTransform>();
            nameRect.anchorMin = new Vector2(0, 1);
            nameRect.anchorMax = new Vector2(1, 1);
            nameRect.pivot = new Vector2(0.5f, 1);
            nameRect.anchoredPosition = new Vector2(0, -8);
            nameRect.sizeDelta = new Vector2(-20, 28);

            TMP_Text nameText = nameObj.AddComponent<TextMeshProUGUI>();
            nameText.text = lobby.LobbyName;
            nameText.fontSize = 22;
            nameText.fontStyle = FontStyles.Bold;
            nameText.alignment = TextAlignmentOptions.TopLeft;
            nameText.color = Color.white;

            GameObject infoObj = new GameObject("Info");
            infoObj.transform.SetParent(card.transform, false);
            RectTransform infoRect = infoObj.AddComponent<RectTransform>();
            infoRect.anchorMin = new Vector2(0, 0);
            infoRect.anchorMax = new Vector2(1, 0);
            infoRect.pivot = new Vector2(0.5f, 0);
            infoRect.anchoredPosition = new Vector2(0, 8);
            infoRect.sizeDelta = new Vector2(-120, 22);

            TMP_Text infoText = infoObj.AddComponent<TextMeshProUGUI>();
            string sourceTag = lobby.Source == "neolobbyst" ? "[NEO] " : "[GAME] ";
            infoText.text = $"{sourceTag}{lobby.HostName} | {lobby.PlayerCount}/{lobby.MaxPlayers} | {lobby.Region}";
            infoText.fontSize = 16;
            infoText.alignment = TextAlignmentOptions.BottomLeft;
            infoText.color = lobby.Source == "neolobbyst" ? new Color(0.3f, 0.8f, 0.3f, 1) : new Color(0.7f, 0.7f, 0.7f, 1);

            GameObject joinObj = new GameObject("JoinLabel");
            joinObj.transform.SetParent(card.transform, false);
            RectTransform joinRect = joinObj.AddComponent<RectTransform>();
            joinRect.anchorMin = new Vector2(1, 0.5f);
            joinRect.anchorMax = new Vector2(1, 0.5f);
            joinRect.pivot = new Vector2(1, 0.5f);
            joinRect.anchoredPosition = new Vector2(-15, 0);
            joinRect.sizeDelta = new Vector2(80, 30);

            TMP_Text joinText = joinObj.AddComponent<TextMeshProUGUI>();
            bool isFull = lobby.PlayerCount >= lobby.MaxPlayers;
            joinText.text = isFull ? "FULL" : "JOIN →";
            joinText.fontSize = 16;
            joinText.fontStyle = FontStyles.Bold;
            joinText.alignment = TextAlignmentOptions.Center;
            joinText.color = isFull ? new Color(0.9f, 0.3f, 0.3f, 1) : (isNeo ? new Color(0.4f, 0.9f, 0.4f, 1) : new Color(0.4f, 0.7f, 0.9f, 1));

            _lobbyItems.Add(card);
        }

        private void TryJoinLobby(OpenGameInfo lobby)
        {
            if (lobby.PlayerCount >= 4 || string.IsNullOrEmpty(lobby.LobbyId)) return;
            MelonLogger.Msg("[NeoLobbyUI] Joining: " + lobby.LobbyId);

            SteamInviteDispatcher dispatcher = FindObjectOfType<SteamInviteDispatcher>();
            if (dispatcher != null)
            {
                dispatcher.RequestPublicJoinLobby(lobby.LobbyId, () =>
                {
                    dispatcher.JoinFriendWithMatchKeyProcess(lobby.LobbyId);
                });
                Hide();
                return;
            }

            if (ulong.TryParse(lobby.LobbyId, out ulong lid))
            {
                CSteamID sid = new CSteamID(lid);
                if (sid.IsValid()) { SteamMatchmaking.JoinLobby(sid); Hide(); }
            }
        }

        private void CreateRoom()
        {
            string name = "NeoLobby Room";
            bool isPublic = true;

            MelonLogger.Msg($"[NeoLobbyUI] Creating room: {name}, Public: {isPublic}");
            _statusText.text = "Creating room...";

            try
            {
                var mainMenu = FindObjectOfType<MainMenu>();
                if (mainMenu == null)
                {
                    _statusText.text = "MainMenu not found";
                    return;
                }

                var createRoomMethod = typeof(MainMenu).GetMethod("CreateRoom", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (createRoomMethod == null)
                {
                    MelonLogger.Error("[NeoLobbyUI] CreateRoom method not found on MainMenu");
                    _statusText.text = "Cannot find CreateRoom method";
                    return;
                }

                var coroutine = (System.Collections.IEnumerator)createRoomMethod.Invoke(mainMenu, null);
                mainMenu.StartCoroutine(coroutine);

                _statusText.text = "Room starting...";
                Hide();
            }
            catch (Exception ex)
            {
                MelonLogger.Error("[NeoLobbyUI] Create room failed: " + ex.Message);
                _statusText.text = "Failed to create room";
            }
        }

        private void LoadGame()
        {
            MelonLogger.Msg("[NeoLobbyUI] Opening load game UI...");
            
            try
            {
                var mainMenu = FindObjectOfType<MainMenu>();
                if (mainMenu == null)
                {
                    _statusText.text = "MainMenu not found";
                    return;
                }

                var uimanProp = typeof(MainMenu).GetProperty("uiman", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                var ui_mainmenuField = typeof(MainMenu).GetField("ui_mainmenu", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                var uiprefab_loadtramField = typeof(MainMenu).GetField("uiprefab_loadtram", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

                if (uimanProp == null || ui_mainmenuField == null || uiprefab_loadtramField == null)
                {
                    MelonLogger.Error("[NeoLobbyUI] Required fields not found on MainMenu");
                    _statusText.text = "Cannot access load UI";
                    return;
                }

                var uiman = uimanProp.GetValue(mainMenu) as UIManager;
                var ui_mainmenu = ui_mainmenuField.GetValue(mainMenu);
                var uiprefab_loadtram = uiprefab_loadtramField.GetValue(mainMenu) as GameObject;

                if (uiman == null || ui_mainmenu == null || uiprefab_loadtram == null)
                {
                    _statusText.text = "Load UI components not found";
                    return;
                }

                var loadtram = uiman.InstatiateUIPrefab<UIPrefab_LoadTram>(uiprefab_loadtram, eUIHeight.Top);
                loadtram.Hide();

                EventSystem.current?.SetSelectedGameObject(null);
                loadtram.InitSaveInfoList();
                uiman.ui_escapeStack.Add(loadtram);
                loadtram.Show();

                Hide();
                MelonLogger.Msg("[NeoLobbyUI] Load game UI opened");
            }
            catch (Exception ex)
            {
                MelonLogger.Error("[NeoLobbyUI] Load game failed: " + ex.Message);
                _statusText.text = "Failed to open load UI";
            }
        }
    }
}
